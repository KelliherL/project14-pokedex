"""Stub-grade text-to-speech: Windows built-in System.Speech voice, offline,
zero dependencies. The event build replaces this with pre-generated Piper
WAVs (see TECH-STACK.md); the robotic voice is thematically on-brand anyway.

Text is passed via stdin to avoid any shell-quoting issues.
"""

import subprocess
import sys
import threading

_PS_SCRIPT = (
    "Add-Type -AssemblyName System.Speech; "
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
    "$s.Rate = 1; "
    "$s.Speak([Console]::In.ReadToEnd())"
)


def _speak_windows(text: str) -> None:
    subprocess.run(
        ["powershell", "-NoProfile", "-Command", _PS_SCRIPT],
        input=text,
        text=True,
        capture_output=True,
        check=False,  # speech failure must never crash the kiosk loop
    )


def speak(text: str, mute: bool = False) -> None:
    """Say the line without blocking the capture loop."""
    print(f"[say] {text}")
    if mute:
        return
    if sys.platform == "win32":
        threading.Thread(target=_speak_windows, args=(text,), daemon=True).start()
    # Non-Windows: printed only; Piper integration replaces this anyway.
