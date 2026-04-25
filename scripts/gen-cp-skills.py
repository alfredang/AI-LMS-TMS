"""Regenerate lib/cp-skills.ts from the course-approval-skills-list Excel.

Usage:
    python scripts/gen-cp-skills.py <path-to-xlsx>
"""
import json
import os
import sys

import openpyxl


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python scripts/gen-cp-skills.py <xlsx>", file=sys.stderr)
        sys.exit(2)
    xlsx_path = sys.argv[1]
    wb = openpyxl.load_workbook(xlsx_path)
    ws = wb.active
    skills = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 2:  # skip title + header
            continue
        name = row[1]
        desc = row[2]
        if name and str(name).strip():
            skills.append({
                "name": str(name).strip(),
                "description": str(desc).strip() if desc else "",
            })

    header = (
        "// Source: course-approval-skills-list (30 Sept 2025).\n"
        "// Do not hand-edit — regenerate via: python scripts/gen-cp-skills.py <xlsx>\n"
        "export interface CpSkill {\n"
        "  name: string;\n"
        "  description: string;\n"
        "}\n\n"
        "export const CP_SKILLS: CpSkill[] = "
    )
    body = json.dumps(skills, ensure_ascii=False, indent=2)
    ts = header + body + ";\n"

    out_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "lib",
        "cp-skills.ts",
    )
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(ts)
    print(f"Wrote {len(skills)} skills -> {out_path}")


if __name__ == "__main__":
    main()
