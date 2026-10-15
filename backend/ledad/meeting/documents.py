import base64
import io
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from pypdf import PdfReader

from ..errors import AppError

MIME_TYPES = {
    ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def presentation_pdf(data: bytes, suffix: str):
    try:
        if suffix == ".pptx":
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if "ppt/presentation.xml" not in archive.namelist():
                    raise ValueError()
                if sum(f.file_size for f in archive.infolist()) > 100 * 1024 * 1024:
                    raise AppError("展開後のPowerPointは100MB以内にしてください。")
        elif not data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
            raise ValueError()
    except (ValueError, zipfile.BadZipFile):
        raise AppError("PowerPointを読み取れません。ファイルの形式を確認してください。") from None
    executable = shutil.which("soffice") or next((
        str(p) for p in [
            Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
            Path("C:/Program Files/LibreOffice/program/soffice.exe"),
        ] if p.is_file()
    ), None)
    if not executable:
        raise AppError("PowerPointの変換にはLibreOfficeが必要です。インストールするか、PDFで追加してください。")
    with tempfile.TemporaryDirectory(prefix="ledad-slides-") as directory:
        root = Path(directory)
        source = root / ("slides" + suffix)
        source.write_bytes(data)
        try:
            subprocess.run(
                [executable, f"-env:UserInstallation={(root / 'profile').as_uri()}",
                 "--headless", "--convert-to", "pdf", "--outdir", str(root), str(source)],
                check=True, capture_output=True, timeout=60,
            )
            result = root / "slides.pdf"
            if result.stat().st_size > 20 * 1024 * 1024:
                raise AppError("変換後のPDFは20MB以内にしてください。")
            return result.read_bytes()
        except (OSError, subprocess.SubprocessError):
            raise AppError("PowerPointをPDFに変換できませんでした。PDFで追加してください。") from None


def extract_document(data: bytes, name: str):
    suffix = Path(name).suffix.lower()
    if suffix in {".ppt", ".pptx"}:
        result = extract_document(presentation_pdf(data, suffix), "slides.pdf")
        return {**result, "format": "presentation"}
    mime = MIME_TYPES.get(suffix)
    if mime and mime.startswith("image/"):
        valid = (
            (suffix == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
            or (suffix in {".jpg", ".jpeg"} and data.startswith(b"\xff\xd8\xff"))
            or (suffix == ".webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP")
        )
        if not valid:
            raise AppError("画像を読み取れません。ファイルの形式を確認してください。")
        return {
            "format": "image", "pages": [], "warning": "",
            "content": {"type": "input_image", "image_url":
                        f"data:{mime};base64,{base64.b64encode(data).decode()}", "detail": "high"},
        }
    if name.lower().endswith(".pdf"):
        try:
            pdf = PdfReader(io.BytesIO(data))
            if pdf.is_encrypted:
                raise ValueError("encrypted")
            if not pdf.pages or len(pdf.pages) > 200:
                raise AppError("PDFは200ページ以内にしてください。")
            pages = [
                {"number": i + 1, "text": (p.extract_text() or "").strip()}
                for i, p in enumerate(pdf.pages)
            ]
            if any(len(p["text"]) > 100_000 for p in pages):
                raise AppError("1ページのテキストは10万文字以内にしてください。")
            return {
                "format": "pdf",
                "pages": pages,
                "warning": "",
                "content": {"type": "input_file", "filename": Path(name).name,
                            "file_data": "data:application/pdf;base64,"
                            + base64.b64encode(data).decode(), "detail": "high"},
            }
        except AppError:
            raise
        except Exception:
            raise AppError(
                "PDFを読み取れません。破損やパスワード保護を確認してください。"
            ) from None
    if not re.search(r"\.(txt|md)$", name, re.IGNORECASE):
        raise AppError("PDF・PPT・PPTX・PNG・JPEG・WebP・TXT・Markdownに対応しています。")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise AppError("テキストをUTF-8で保存してから登録してください。") from None
    if len(text) > 100_000:
        raise AppError("テキストは10万文字以内にしてください。")
    if not text.strip():
        raise AppError("ファイルに内容がありません。")
    pages = [
        {"number": i + 1, "text": t.strip()}
        for i, t in enumerate(re.split(r"\r?\n\s*---\s*\r?\n|\f", text))
    ]
    if len(pages) > 200:
        raise AppError("資料は200ページ以内にしてください。")
    return {"format": "text", "pages": pages, "warning": "", "content": {
        "type": "input_text",
        "text": "\n\n".join(f"## p.{p['number']}\n{p['text']}" for p in pages),
    }}
