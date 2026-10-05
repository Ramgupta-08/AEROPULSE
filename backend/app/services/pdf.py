"""Server-side PDF generation (ReportLab) in the AeroPulse visual style."""

from __future__ import annotations

from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = colors.HexColor("#0F172A")
SUBTLE = colors.HexColor("#5B6577")
BORDER = colors.HexColor("#E3E7ED")
ACCENT = colors.HexColor("#2F6FE0")
STATUS = {
    "ready": colors.HexColor("#18874C"),
    "caution": colors.HexColor("#A86A0A"),
    "grounded": colors.HexColor("#C8282E"),
}

_ss = getSampleStyleSheet()
H1 = ParagraphStyle(
    "h1", parent=_ss["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=INK, spaceAfter=2
)
H2 = ParagraphStyle(
    "h2",
    parent=_ss["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=12,
    leading=15,
    textColor=INK,
    spaceBefore=10,
    spaceAfter=4,
)
BODY = ParagraphStyle("body", parent=_ss["BodyText"], fontName="Helvetica", fontSize=9, leading=12.5, textColor=INK)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8, leading=10.5, textColor=SUBTLE)


def table(rows: list[list], widths: list[float] | None = None, status_col: int | None = None) -> Table:
    t = Table(rows, colWidths=widths, repeatRows=1)
    style = [
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), SUBTLE),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, BORDER),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]
    if status_col is not None:
        for i, r in enumerate(rows[1:], start=1):
            c = STATUS.get(str(r[status_col]).lower())
            if c is not None:
                style.append(("TEXTCOLOR", (status_col, i), (status_col, i), c))
                style.append(("FONT", (status_col, i), (status_col, i), "Helvetica-Bold", 8))
    t.setStyle(TableStyle(style))
    return t


def build(title: str, subtitle: str, story: list, landscape_mode: bool = False) -> bytes:
    buf = BytesIO()
    size = landscape(A4) if landscape_mode else A4

    def chrome(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(ACCENT)
        canvas.setLineWidth(2)
        canvas.line(15 * mm, size[1] - 12 * mm, 30 * mm, size[1] - 12 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(SUBTLE)
        canvas.drawString(15 * mm, 10 * mm, "AeroPulse · simulated fleet data · generated on-premise")
        canvas.drawRightString(size[0] - 15 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf,
        pagesize=size,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=title,
    )
    doc.build(
        [Paragraph(title, H1), Paragraph(subtitle, SMALL), Spacer(1, 6 * mm), *story],
        onFirstPage=chrome,
        onLaterPages=chrome,
    )
    return buf.getvalue()
