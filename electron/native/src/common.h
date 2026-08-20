#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <psapi.h>
#include <string>

inline std::string NarrowFromWide(const wchar_t* wide) {
  if (!wide) return std::string();
  int len = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (len <= 0) return std::string();
  std::string result(len - 1, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, result.data(), len, nullptr, nullptr);
  return result;
}

inline std::string ProcessNameFromPid(DWORD pid) {
  if (pid == 0) return std::string();

  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return std::string();

  wchar_t nameBuffer[MAX_PATH] = {0};
  DWORD size = MAX_PATH;
  std::string name;

  if (QueryFullProcessImageNameW(process, 0, nameBuffer, &size)) {
    std::wstring fullPath(nameBuffer, size);
    size_t slash = fullPath.find_last_of(L"\\/");
    std::wstring base = (slash == std::wstring::npos) ? fullPath : fullPath.substr(slash + 1);
    name = NarrowFromWide(base.c_str());
  }

  CloseHandle(process);
  return name;
}
