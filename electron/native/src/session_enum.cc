#include "session_enum.h"
#include "common.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <string>
#include <vector>

namespace {

struct AudioSessionInfo {
  DWORD pid;
  std::string name;
};

class ListAudioSessionsWorker : public Napi::AsyncWorker {
 public:
  ListAudioSessionsWorker(Napi::Env env, Napi::Promise::Deferred deferred)
      : Napi::AsyncWorker(env), deferred_(deferred) {}

  void Execute() override {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool comInitialized = SUCCEEDED(hr) || hr == S_FALSE;

    IMMDeviceEnumerator* enumerator = nullptr;
    IMMDevice* device = nullptr;
    IAudioSessionManager2* sessionManager = nullptr;
    IAudioSessionEnumerator* sessionEnum = nullptr;

    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                           __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));

    if (SUCCEEDED(hr)) {
      hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    }

    if (SUCCEEDED(hr)) {
      hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                             reinterpret_cast<void**>(&sessionManager));
    }

    if (SUCCEEDED(hr)) {
      hr = sessionManager->GetSessionEnumerator(&sessionEnum);
    }

    if (SUCCEEDED(hr) && sessionEnum) {
      int count = 0;
      sessionEnum->GetCount(&count);

      std::vector<DWORD> seenPids;

      for (int i = 0; i < count; i++) {
        IAudioSessionControl* control = nullptr;
        if (FAILED(sessionEnum->GetSession(i, &control)) || !control) continue;

        IAudioSessionControl2* control2 = nullptr;
        if (SUCCEEDED(control->QueryInterface(__uuidof(IAudioSessionControl2),
                                               reinterpret_cast<void**>(&control2))) &&
            control2) {
          DWORD pid = 0;
          control2->GetProcessId(&pid);

          bool isSystemSounds = control2->IsSystemSoundsSession() == S_OK;

          if (pid != 0 && !isSystemSounds) {
            bool alreadySeen = false;
            for (DWORD seen : seenPids) {
              if (seen == pid) {
                alreadySeen = true;
                break;
              }
            }

            if (!alreadySeen) {
              seenPids.push_back(pid);
              std::string name = ProcessNameFromPid(pid);
              if (!name.empty()) {
                results_.push_back({pid, name});
              }
            }
          }

          control2->Release();
        }

        control->Release();
      }
    }

    if (sessionEnum) sessionEnum->Release();
    if (sessionManager) sessionManager->Release();
    if (device) device->Release();
    if (enumerator) enumerator->Release();
    if (comInitialized) CoUninitialize();
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::HandleScope scope(env);

    Napi::Array array = Napi::Array::New(env, results_.size());
    for (size_t i = 0; i < results_.size(); i++) {
      Napi::Object item = Napi::Object::New(env);
      item.Set("pid", Napi::Number::New(env, static_cast<double>(results_[i].pid)));
      item.Set("name", Napi::String::New(env, results_[i].name));
      array.Set(static_cast<uint32_t>(i), item);
    }

    deferred_.Resolve(array);
  }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::vector<AudioSessionInfo> results_;
};

}  // namespace

Napi::Value ListAudioSessions(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new ListAudioSessionsWorker(env, deferred);
  worker->Queue();
  return deferred.Promise();
}
