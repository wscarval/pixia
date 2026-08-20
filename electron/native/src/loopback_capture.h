#pragma once
#include <napi.h>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <atomic>
#include <thread>

// Captura o áudio renderizado por um processo específico (e, opcionalmente,
// sua árvore de processos filhos) usando a API de "process loopback" do
// WASAPI (Windows 10 2004+). Os frames PCM capturados são entregues à
// callback JS informada no construtor, no formato retornado por getFormat().
class ProcessLoopbackCapture : public Napi::ObjectWrap<ProcessLoopbackCapture> {
 public:
  static Napi::Function GetClass(Napi::Env env);

  explicit ProcessLoopbackCapture(const Napi::CallbackInfo& info);
  ~ProcessLoopbackCapture() override;

 private:
  Napi::Value Start(const Napi::CallbackInfo& info);
  Napi::Value Stop(const Napi::CallbackInfo& info);
  Napi::Value GetFormat(const Napi::CallbackInfo& info);

  void CaptureThreadMain();
  void StopInternal();

  DWORD pid_ = 0;
  Napi::ThreadSafeFunction tsfn_;
  std::thread captureThread_;
  std::atomic<bool> running_{false};
  HANDLE stopEvent_ = nullptr;

  std::atomic<int> sampleRate_{0};
  std::atomic<int> channels_{0};
  std::atomic<int> bitsPerSample_{0};
  std::atomic<bool> isFloat_{false};
};
