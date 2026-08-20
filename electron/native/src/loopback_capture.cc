#include "loopback_capture.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objidl.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmreg.h>
#include <ksmedia.h>
#include <cstdio>
#include <cstring>

namespace {

// Implementação mínima de IActivateAudioInterfaceCompletionHandler: recebe o
// resultado assíncrono de ActivateAudioInterfaceAsync e sinaliza um evento
// quando a ativação termina (com sucesso ou erro).
//
// Implementa também IAgileObject (interface marcadora, sem métodos próprios)
// para que o COM trate este objeto como "livre de apartamento". Sem isso,
// ActivateAudioInterfaceAsync falha de forma síncrona com E_ILLEGAL_METHOD_CALL
// (0x8000000E): a entrega do callback para a thread chamadora exige marshaling
// entre apartamentos, que um objeto COM "cru" (sem proxy/stub nem marcação de
// agilidade) não suporta.
class ActivationHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  ActivationHandler() { completedEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr); }

  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refCount_); }

  ULONG STDMETHODCALLTYPE Release() override {
    ULONG count = InterlockedDecrement(&refCount_);
    if (count == 0) delete this;
    return count;
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppvObject) override {
    if (!ppvObject) return E_POINTER;

    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppvObject = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }

    if (riid == __uuidof(IAgileObject)) {
      *ppvObject = static_cast<IAgileObject*>(this);
      AddRef();
      return S_OK;
    }

    *ppvObject = nullptr;
    return E_NOINTERFACE;
  }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT hrActivate = E_FAIL;
    IUnknown* activatedInterface = nullptr;

    operation->GetActivateResult(&hrActivate, &activatedInterface);

    activateResult = hrActivate;

    if (SUCCEEDED(hrActivate) && activatedInterface) {
      activatedInterface->QueryInterface(__uuidof(IAudioClient),
                                          reinterpret_cast<void**>(&audioClient));
      activatedInterface->Release();
    }

    SetEvent(completedEvent);
    return S_OK;
  }

  HANDLE completedEvent = nullptr;
  HRESULT activateResult = E_FAIL;
  IAudioClient* audioClient = nullptr;

 private:
  ~ActivationHandler() {
    if (completedEvent) CloseHandle(completedEvent);
  }

  volatile ULONG refCount_ = 1;
};

struct AudioChunk {
  uint8_t* data;
  size_t size;
};

void DeliverChunk(Napi::Env env, Napi::Function callback, AudioChunk* chunk) {
  if (env != nullptr && callback != nullptr) {
    Napi::HandleScope scope(env);
    Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, chunk->data, chunk->size);
    callback.Call({buffer});
  }
  delete[] chunk->data;
  delete chunk;
}

// Obtém o formato de mixagem do dispositivo de saída padrão. O IAudioClient
// virtual de process-loopback não implementa GetMixFormat (retorna
// E_NOTIMPL) — mas como ele espelha exatamente esse mecanismo de mixagem, o
// formato do dispositivo real é o que precisa ser usado no Initialize().
// Loopback (diferente de render normal) não reamostra implicitamente: um
// formato que não bata exatamente faz o Initialize "funcionar" mas nunca
// entregar nenhum frame depois.
WAVEFORMATEX* GetDefaultDeviceMixFormat() {
  IMMDeviceEnumerator* enumerator = nullptr;
  IMMDevice* defaultDevice = nullptr;
  IAudioClient* probeClient = nullptr;
  WAVEFORMATEX* mixFormat = nullptr;

  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                 __uuidof(IMMDeviceEnumerator),
                                 reinterpret_cast<void**>(&enumerator));
  if (SUCCEEDED(hr)) hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice);
  if (SUCCEEDED(hr)) {
    hr = defaultDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                                  reinterpret_cast<void**>(&probeClient));
  }
  if (SUCCEEDED(hr)) hr = probeClient->GetMixFormat(&mixFormat);

  if (probeClient) probeClient->Release();
  if (defaultDevice) defaultDevice->Release();
  if (enumerator) enumerator->Release();

  return mixFormat;
}

bool IsFloatFormat(const WAVEFORMATEX* format) {
  if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) return true;

  if (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
      format->cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
    const auto* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
    return ext->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
  }

  return false;
}

}  // namespace

Napi::Function ProcessLoopbackCapture::GetClass(Napi::Env env) {
  return DefineClass(env, "ProcessLoopbackCapture",
                      {
                          InstanceMethod("start", &ProcessLoopbackCapture::Start),
                          InstanceMethod("stop", &ProcessLoopbackCapture::Stop),
                          InstanceMethod("getFormat", &ProcessLoopbackCapture::GetFormat),
                      });
}

ProcessLoopbackCapture::ProcessLoopbackCapture(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<ProcessLoopbackCapture>(info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Esperado (pid: number, onChunk: function)")
        .ThrowAsJavaScriptException();
    return;
  }

  pid_ = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());

  Napi::Function callback = info[1].As<Napi::Function>();
  tsfn_ = Napi::ThreadSafeFunction::New(env, callback, "ProcessLoopbackCaptureCallback", 0, 1);
}

ProcessLoopbackCapture::~ProcessLoopbackCapture() { StopInternal(); }

Napi::Value ProcessLoopbackCapture::Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (running_.exchange(true)) return env.Undefined();

  stopEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  captureThread_ = std::thread(&ProcessLoopbackCapture::CaptureThreadMain, this);

  return env.Undefined();
}

Napi::Value ProcessLoopbackCapture::Stop(const Napi::CallbackInfo& info) {
  StopInternal();
  return info.Env().Undefined();
}

Napi::Value ProcessLoopbackCapture::GetFormat(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int sampleRate = sampleRate_.load();

  if (sampleRate == 0) return env.Null();

  Napi::Object format = Napi::Object::New(env);
  format.Set("sampleRate", Napi::Number::New(env, sampleRate));
  format.Set("channels", Napi::Number::New(env, channels_.load()));
  format.Set("bitsPerSample", Napi::Number::New(env, bitsPerSample_.load()));
  format.Set("isFloat", Napi::Boolean::New(env, isFloat_.load()));
  return format;
}

void ProcessLoopbackCapture::StopInternal() {
  if (!running_.exchange(false)) return;

  if (stopEvent_) SetEvent(stopEvent_);
  if (captureThread_.joinable()) captureThread_.join();
  if (stopEvent_) {
    CloseHandle(stopEvent_);
    stopEvent_ = nullptr;
  }

  tsfn_.Release();
}

void ProcessLoopbackCapture::CaptureThreadMain() {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  bool comInitialized = SUCCEEDED(hr) || hr == S_FALSE;

  AUDIOCLIENT_ACTIVATION_PARAMS activationParams = {};
  activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activationParams.ProcessLoopbackParams.TargetProcessId = pid_;
  activationParams.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT propVariant;
  ZeroMemory(&propVariant, sizeof(propVariant));
  propVariant.vt = VT_BLOB;
  propVariant.blob.cbSize = sizeof(activationParams);
  propVariant.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);

  auto* handler = new ActivationHandler();
  IActivateAudioInterfaceAsyncOperation* asyncOp = nullptr;

  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
                                    &propVariant, handler, &asyncOp);

  IAudioClient* audioClient = nullptr;

  if (SUCCEEDED(hr)) {
    WaitForSingleObject(handler->completedEvent, INFINITE);
    hr = handler->activateResult;
    audioClient = handler->audioClient;
    handler->audioClient = nullptr;
  }

  if (asyncOp) asyncOp->Release();
  handler->Release();

  if (FAILED(hr) || !audioClient) {
    fprintf(stderr, "[process_loopback] falha ao ativar áudio do processo %lu: 0x%08lx\n", pid_,
            static_cast<unsigned long>(hr));
    if (comInitialized) CoUninitialize();
    running_ = false;
    return;
  }

  WAVEFORMATEX* mixFormat = GetDefaultDeviceMixFormat();

  if (!mixFormat) {
    fprintf(stderr, "[process_loopback] não foi possível obter o formato de captura\n");
    audioClient->Release();
    if (comInitialized) CoUninitialize();
    running_ = false;
    return;
  }

  const REFERENCE_TIME bufferDuration = 2000000;  // 200ms, em unidades de 100ns
  HANDLE audioEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);

  hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                bufferDuration, 0, mixFormat, nullptr);

  IAudioCaptureClient* captureClient = nullptr;

  if (SUCCEEDED(hr)) hr = audioClient->SetEventHandle(audioEvent);
  if (SUCCEEDED(hr)) {
    hr = audioClient->GetService(__uuidof(IAudioCaptureClient),
                                  reinterpret_cast<void**>(&captureClient));
  }
  if (SUCCEEDED(hr)) hr = audioClient->Start();

  if (FAILED(hr)) {
    fprintf(stderr, "[process_loopback] falha ao iniciar captura do processo %lu: 0x%08lx\n", pid_,
            static_cast<unsigned long>(hr));
    if (captureClient) captureClient->Release();
    audioClient->Release();
    CoTaskMemFree(mixFormat);
    CloseHandle(audioEvent);
    if (comInitialized) CoUninitialize();
    running_ = false;
    return;
  }

  WAVEFORMATEX format = *mixFormat;
  sampleRate_ = static_cast<int>(format.nSamplesPerSec);
  channels_ = format.nChannels;
  bitsPerSample_ = format.wBitsPerSample;
  isFloat_ = IsFloatFormat(mixFormat);
  CoTaskMemFree(mixFormat);
  mixFormat = nullptr;

  HANDLE waitHandles[2] = {audioEvent, stopEvent_};

  // Espera pelo evento OU por um timeout curto: o dispositivo virtual de
  // process-loopback nem sempre sinaliza o evento de forma confiável, então
  // também fazemos polling como salvaguarda, além de reagir ao evento.
  while (true) {
    DWORD waitResult = WaitForMultipleObjects(2, waitHandles, FALSE, 20);
    if (waitResult == WAIT_OBJECT_0 + 1) break;  // stopEvent_
    if (waitResult != WAIT_OBJECT_0 && waitResult != WAIT_TIMEOUT) continue;

    UINT32 framesAvailable = 0;
    while (SUCCEEDED(captureClient->GetNextPacketSize(&framesAvailable)) && framesAvailable > 0) {
      BYTE* data = nullptr;
      DWORD flags = 0;

      HRESULT bufferHr = captureClient->GetBuffer(&data, &framesAvailable, &flags, nullptr, nullptr);
      if (FAILED(bufferHr)) break;

      size_t byteCount = static_cast<size_t>(framesAvailable) * format.nBlockAlign;
      auto* copy = new uint8_t[byteCount];

      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        memset(copy, 0, byteCount);
      } else {
        memcpy(copy, data, byteCount);
      }

      captureClient->ReleaseBuffer(framesAvailable);

      auto* chunk = new AudioChunk{copy, byteCount};
      napi_status callStatus = tsfn_.NonBlockingCall(chunk, DeliverChunk);
      if (callStatus != napi_ok) {
        delete[] chunk->data;
        delete chunk;
      }
    }
  }

  audioClient->Stop();
  captureClient->Release();
  audioClient->Release();
  CloseHandle(audioEvent);
  if (comInitialized) CoUninitialize();
}
