#!/usr/bin/env python3

import json
import sys
from pathlib import Path

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.stderr.write(
        "Writing .xlsx files requires Python package openpyxl. "
        "Run this script from a Codex workspace with bundled spreadsheet dependencies.\n"
    )
    sys.exit(2)


if len(sys.argv) != 3:
    sys.stderr.write("Usage: scripts/write-am-workbook.py <account-packet.json> <MY_ACCOUNTS.xlsx>\n")
    sys.exit(2)

packet_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
packet = json.loads(packet_path.read_text())
accounts = packet["accounts"]
active_contacts = packet.get("activeContacts", [])
am = packet["am"]
summary = packet["summary"]

wb = Workbook()
default = wb.active
wb.remove(default)

fills = {
    "header": PatternFill("solid", fgColor="1F2937"),
    "blue": PatternFill("solid", fgColor="DBEAFE"),
    "green": PatternFill("solid", fgColor="DCFCE7"),
    "yellow": PatternFill("solid", fgColor="FEF3C7"),
    "orange": PatternFill("solid", fgColor="FFEDD5"),
    "gray": PatternFill("solid", fgColor="E5E7EB"),
    "white": PatternFill("solid", fgColor="FFFFFF"),
}
thin = Side(style="thin", color="D1D5DB")
border = Border(left=thin, right=thin, top=thin, bottom=thin)


def title_cell(sheet, cell, value):
    sheet[cell] = value
    sheet[cell].font = Font(size=18, bold=True, color="111827")


def section_header(sheet, row, values):
    for col, value in enumerate(values, 1):
        cell = sheet.cell(row=row, column=col, value=value)
        cell.fill = fills["header"]
        cell.font = Font(bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center")
        cell.border = border


def style_table(sheet, min_row, max_row, min_col, max_col):
    for row in sheet.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
        for cell in row:
            cell.border = border
            cell.alignment = Alignment(vertical="top", wrap_text=True)


def set_widths(sheet, widths):
    for index, width in enumerate(widths, 1):
        sheet.column_dimensions[get_column_letter(index)].width = width


start = wb.create_sheet("Start Here")
title_cell(start, "A1", "myRA AM Tour")
start["A3"] = "AM"
start["B3"] = am["name"]
start["A4"] = "Email"
start["B4"] = am["email"]
start["A6"] = "Open Codex in this folder and say:"
start["A7"] = packet["tour"]["startPrompt"]
start["A7"].font = Font(size=14, bold=True, color="1D4ED8")
start["A9"] = "What Codex will do"
start["A9"].font = Font(bold=True)
actions = [
    "Check Day AI MCP access.",
    "Load account-packet.json for speed.",
    "Show your priority queue.",
    "Recommend the next account.",
    "Pause before every Day AI write.",
    "Show a Day AI receipt after every write.",
]
for offset, action in enumerate(actions, 10):
    start.cell(row=offset, column=1, value=f"- {action}")
start["D9"] = "What Codex will not do"
start["D9"].font = Font(bold=True)
guardrails = [
    "It will not send emails.",
    "It will not write to Freshsales.",
    "It will not create contacts without approval.",
    "It will not use Apollo/Clearout keys from this package.",
]
for offset, action in enumerate(guardrails, 10):
    start.cell(row=offset, column=4, value=f"- {action}")
set_widths(start, [24, 34, 4, 28, 42])
start.freeze_panes = "A9"

today = wb.create_sheet("Today")
title_cell(today, "A1", "Today's Tour")
recommended = next((account for account in accounts if account["status"] == "ready_for_intake"), accounts[0] if accounts else None)
today_rows = [
    ("Recommended account", recommended["accountName"] if recommended else "None ready"),
    ("Domain", recommended.get("domain", "") if recommended else ""),
    ("Priority", recommended.get("priority", "") if recommended else ""),
    ("Next action", recommended.get("nextAction", "") if recommended else ""),
    ("Start prompt", packet["tour"]["startPrompt"]),
    ("Intake command", recommended.get("intakeCommand", "") if recommended else ""),
]
for row_index, (label, value) in enumerate(today_rows, 3):
    today.cell(row=row_index, column=1, value=label).font = Font(bold=True)
    today.cell(row=row_index, column=2, value=value)
style_table(today, 3, 8, 1, 2)
set_widths(today, [24, 95])

queue = wb.create_sheet("My Queue")
queue_headers = ["Priority", "Status", "Account Name", "Domain", "Confidence", "Next Action", "Notes", "Source"]
section_header(queue, 1, queue_headers)
for index, account in enumerate(accounts, 2):
    values = [
        account.get("priority", ""),
        account.get("status", ""),
        account.get("accountName", ""),
        account.get("domain", ""),
        account.get("domainConfidence", ""),
        account.get("nextAction", ""),
        account.get("notes", ""),
        account.get("domainSourceUrl", ""),
    ]
    for col, value in enumerate(values, 1):
        queue.cell(row=index, column=col, value=value)
    fill = {
        "ready_for_intake": fills["green"],
        "domain_pending": fills["yellow"],
        "identity_review": fills["orange"],
        "hold": fills["gray"],
    }.get(account.get("status"), fills["white"])
    for col in range(1, len(queue_headers) + 1):
        queue.cell(row=index, column=col).fill = fill
style_table(queue, 1, len(accounts) + 1, 1, len(queue_headers))
queue.auto_filter.ref = f"A1:H{len(accounts) + 1}"
queue.freeze_panes = "A2"
set_widths(queue, [12, 18, 34, 28, 16, 32, 48, 52])

checklist = wb.create_sheet("Tour Checklist")
title_cell(checklist, "A1", "Tour Checklist")
check_items = [
    "Day AI connected",
    "Account selected",
    "Account intake created",
    "Research saved",
    "Contacts mapped",
    "Contacts approved",
    "Cadence created",
    "Draft created",
    "Next task created",
    "Account health reviewed",
]
section_header(checklist, 3, ["Done", "Checkpoint", "Notes"])
for index, item in enumerate(check_items, 4):
    checklist.cell(row=index, column=1, value="")
    checklist.cell(row=index, column=2, value=item)
    checklist.cell(row=index, column=3, value="")
style_table(checklist, 3, len(check_items) + 3, 1, 3)
set_widths(checklist, [12, 34, 70])

handoff = wb.create_sheet("Day AI Handoff")
title_cell(handoff, "A1", "Codex -> Day AI Handoff")
section_header(handoff, 3, ["Checkpoint", "Day AI Write", "Approval Needed", "Receipt Should Show"])
handoff_rows = [
    ("Account intake", "Organization, opportunity/account motion, account context", "Yes", "Object type, name, lifecycle, link or ID"),
    ("Research", "Account plan/context page", "Checkpoint approval", "Context/page name and next step"),
    ("Contacts", "Canonical People only after AM-selected approval", "Yes", "Person names, source, evidence, skipped duplicates"),
    ("Cadence", "Actions and email drafts", "Yes", "Task count, draft count, due dates"),
    ("Log touch", "Ledger/context note and next action", "Yes", "Channel, outcome, next task"),
    ("Account health", "Optional health snapshot/context", "Optional", "Stage, blockers, next action"),
]
for row_index, row in enumerate(handoff_rows, 4):
    for col, value in enumerate(row, 1):
        handoff.cell(row=row_index, column=col, value=value)
style_table(handoff, 3, len(handoff_rows) + 3, 1, 4)
set_widths(handoff, [22, 48, 22, 54])

help_sheet = wb.create_sheet("Help")
title_cell(help_sheet, "A1", "Help Prompts")
section_header(help_sheet, 3, ["If this happens", "Ask Codex"])
help_rows = [
    ("Day AI is not connected", "Fix my Day AI connection."),
    ("You stopped midway", "Resume my myRA AM tour."),
    ("You want proof of writes", "Show what has been saved to Day AI."),
    ("No account can start", "Show accounts needing domains."),
    ("You want to restart", "Restart from my recommended account."),
]
for row_index, row in enumerate(help_rows, 4):
    for col, value in enumerate(row, 1):
        help_sheet.cell(row=row_index, column=col, value=value)
style_table(help_sheet, 3, len(help_rows) + 3, 1, 2)
set_widths(help_sheet, [34, 64])

contacts_sheet = wb.create_sheet("Active Contacts")
title_cell(contacts_sheet, "A1", "Imported Active Contacts")
contact_headers = [
    "Account",
    "Domain",
    "Contact",
    "Email",
    "Title",
    "Role Bucket",
    "Source",
    "Relationship",
    "Last Touch",
    "Next Step",
    "Selected",
    "Notes",
]
section_header(contacts_sheet, 3, contact_headers)
if active_contacts:
    for row_index, contact in enumerate(active_contacts, 4):
        values = [
            contact.get("accountName", ""),
            contact.get("accountDomain", ""),
            contact.get("contactName", ""),
            contact.get("email", ""),
            contact.get("title", ""),
            contact.get("roleBucket", ""),
            contact.get("sourceSystem", ""),
            contact.get("relationshipStatus", ""),
            contact.get("lastTouchAt", ""),
            contact.get("nextStep", ""),
            "Yes" if contact.get("selectedByAm") else "",
            contact.get("notes", ""),
        ]
        for col, value in enumerate(values, 1):
            contacts_sheet.cell(row=row_index, column=col, value=value)
    style_table(contacts_sheet, 3, len(active_contacts) + 3, 1, len(contact_headers))
    contacts_sheet.auto_filter.ref = f"A3:L{len(active_contacts) + 3}"
else:
    contacts_sheet["A4"] = "No active contacts imported yet."
    style_table(contacts_sheet, 3, 4, 1, len(contact_headers))
contacts_sheet.freeze_panes = "A4"
set_widths(contacts_sheet, [30, 26, 28, 34, 34, 22, 18, 20, 20, 36, 12, 44])

for sheet in wb.worksheets:
    sheet.sheet_view.showGridLines = False

output_path.parent.mkdir(parents=True, exist_ok=True)
wb.save(output_path)
