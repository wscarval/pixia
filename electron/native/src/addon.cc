#include <napi.h>
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include "loopback_capture.h"
#include "session_enum.h"

namespace {

// Dado o HWND de uma janela (extraído do id retornado por
// desktopCapturer.getSources, formato "window:<hwnd>:<id>"), devolve o PID
// do processo dono dela. Usado para isolar o áudio de UMA janela ao
// compartilhar a tela, em vez de pegar o áudio do sistema inteiro.
Napi::Value GetWindowProcessId(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Esperado (hwnd: number)").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto hwndValue = static_cast<UINT_PTR>(info[0].As<Napi::Number>().Int64Value());
  HWND hwnd = reinterpret_cast<HWND>(hwndValue);

  DWORD pid = 0;
  DWORD threadId = GetWindowThreadProcessId(hwnd, &pid);

  if (threadId == 0 || pid == 0) return env.Null();
  return Napi::Number::New(env, static_cast<double>(pid));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listAudioSessions", Napi::Function::New(env, ListAudioSessions));
  exports.Set("ProcessLoopbackCapture", ProcessLoopbackCapture::GetClass(env));
  exports.Set("getWindowProcessId", Napi::Function::New(env, GetWindowProcessId));
  return exports;
}

}  // namespace

NODE_API_MODULE(process_loopback, Init)
