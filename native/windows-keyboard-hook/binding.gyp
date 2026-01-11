{
  "targets": [
    {
      "target_name": "windows_keyboard_hook",
      "sources": [ "windows_keyboard_hook.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            "-luser32"
          ]
        }]
      ]
    }
  ]
}


