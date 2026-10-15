import io
import wave


def wav_bytes(pcm):
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(pcm)
    return output.getvalue()


def wav_duration(data):
    try:
        with wave.open(io.BytesIO(data), "rb") as reader:
            return reader.getnframes() / reader.getframerate()
    except (wave.Error, EOFError, ZeroDivisionError):
        return None
