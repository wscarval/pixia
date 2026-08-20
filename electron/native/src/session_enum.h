#pragma once
#include <napi.h>

// Lista processos com uma sessão de áudio ativa no dispositivo de saída
// padrão (equivalente ao que o mixer de volume do Windows mostra).
Napi::Value ListAudioSessions(const Napi::CallbackInfo& info);
