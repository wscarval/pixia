{
  "targets": [
    {
      "target_name": "process_loopback",
      "sources": ["src/addon.cc", "src/session_enum.cc", "src/loopback_capture.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": ["mmdevapi.lib", "ole32.lib", "oleaut32.lib", "uuid.lib", "psapi.lib"],
            "msvs_settings": {
              "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17"] }
            }
          }
        ]
      ]
    }
  ]
}
