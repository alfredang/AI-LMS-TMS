"""
DOCX Template Filler — called from Node.js API
Uses docxtpl (Jinja2) to fill WSQ courseware templates, matching Streamlit logic exactly.

Usage: python fill-template.py <doc_type> <context_json_path> <output_path>
"""

import sys
import json
import re
from datetime import datetime
from docxtpl import DocxTemplate, InlineImage
from docx.shared import Mm
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
TEMPLATE_DIR = os.path.join(PROJECT_DIR, 'public', 'templates', 'courseware')

TEMPLATES = {
    'ap': 'AP_TGS-Ref-No_Course-Title_v1.docx',
    'asr': 'ASR_TGS-Ref-No_Course-Title_v1.docx',
    'fg': 'FG_TGS-Ref-No_Course-Title_v1.docx',
    'lg': 'LG_TGS-Ref-No_Course-Title_v1.docx',
}

METHOD_ABBR = {
    'Written Assessment - Short Answer Questions': 'WA-SAQ',
    'Written Assessment - Question and Answers': 'WA-SAQ',
    'Written Assessment': 'WA-SAQ',
    'Written Exam': 'WA-SAQ',
    'WA(Q&A)': 'WA-SAQ',
    'Practical Performance': 'PP',
    'Practical Exam': 'PP',
    'Case Study': 'CS',
    'Oral Questioning': 'OQ',
    'Role Play': 'RP',
    'Oral Interview': 'OI',
    'Demonstration': 'DEM',
    'Project': 'PRJ',
    'Assignment': 'ASGN',
    'Online Test': 'OT',
}

SECTOR_MAP = {
    'ICT': {'sector': 'Infocomm Technology', 'framework': 'ICT Skills Framework'},
    'LOG': {'sector': 'Logistics', 'framework': 'Logistics Skills Framework'},
    'FIN': {'sector': 'Financial Services', 'framework': 'Financial Services Skills Framework'},
    'HR': {'sector': 'Human Resource', 'framework': 'Human Resource Skills Framework'},
    'MFG': {'sector': 'Manufacturing', 'framework': 'Manufacturing Skills Framework'},
    'BIZ': {'sector': 'Business Management', 'framework': 'Business Management Skills Framework'},
    'LPM': {'sector': 'Lean & Productivity', 'framework': 'Lean Enterprise System Skills Framework'},
    'SEC': {'sector': 'Security', 'framework': 'Security Skills Framework'},
    'CI': {'sector': 'Creative Industries', 'framework': 'Creative Industries Skills Framework'},
    'EHS': {'sector': 'Environmental Services', 'framework': 'Environmental Services Skills Framework'},
    'BIN': {'sector': 'Business Innovation', 'framework': 'Business Innovation Skills Framework'},
}


def get_method_abbr(method_name):
    if not method_name:
        return ''
    if method_name in METHOD_ABBR:
        return METHOD_ABBR[method_name]
    for key, val in METHOD_ABBR.items():
        if key.lower() in method_name.lower():
            return val
    if len(method_name) <= 6 and method_name == method_name.upper():
        return method_name
    return ''.join(w[0].upper() for w in method_name.split() if w)


def get_sector_info(tsc_code):
    if not tsc_code:
        return {'sector': '', 'framework': '', 'level': ''}
    prefix = tsc_code.split('-')[0].upper()
    info = SECTOR_MAP.get(prefix, {'sector': '', 'framework': ''})
    level_match = re.search(r'-(\d+)\.', tsc_code)
    level = f"Level {level_match.group(1)}" if level_match else ''
    return {**info, 'level': level}


def get_field(data, *keys, default=''):
    """Try multiple key names to get a field value."""
    for key in keys:
        val = data.get(key)
        if val:
            return val
    return default


def parse_extracted_text(text):
    """Parse the Claude-extracted markdown text into structured data.
    This is the fallback when structured JSON is not available."""
    result = {
        'Name_of_Organisation': '',
        'Course_Title': '',
        'TGS_Ref_No': '',
        'TSC_Code': '',
        'TSC_Title': '',
        'Course_Overview': '',
        'Total_Training_Hours': '',
        'Total_Assessment_Hours': '',
        'Total_Course_Duration_Hours': '',
        'Learning_Units': [],
        'Assessment_Methods_Details': [],
    }

    if not text:
        return result

    lines = text.split('\n')

    # Extract field:value pairs from the text
    for line in lines:
        clean = line.replace('**', '').strip()
        if not clean:
            continue

        # Try to match "Field | Value" table rows
        if '|' in clean and not clean.startswith('|---'):
            parts = [p.strip() for p in clean.split('|') if p.strip()]
            if len(parts) >= 2:
                field_lower = parts[0].lower()
                value = parts[1]
                if 'training provider' in field_lower or 'organisation' in field_lower:
                    result['Name_of_Organisation'] = value
                elif 'course title' in field_lower and 'tgs' not in field_lower:
                    result['Course_Title'] = value
                elif 'tgs' in field_lower or 'course ref' in field_lower:
                    result['TGS_Ref_No'] = value
                elif 'tsc code' in field_lower:
                    result['TSC_Code'] = value
                elif 'tsc title' in field_lower:
                    result['TSC_Title'] = value
                elif 'total course duration' in field_lower:
                    result['Total_Course_Duration_Hours'] = value
                elif 'training hours' in field_lower or 'instructional' in field_lower:
                    result['Total_Training_Hours'] = value
                elif 'assessment hours' in field_lower or 'assessment duration' in field_lower:
                    result['Total_Assessment_Hours'] = value
                elif 'skills framework' in field_lower:
                    result['Skills_Framework'] = value
                elif 'sector' in field_lower:
                    result['TSC_Sector'] = value
                elif 'proficiency' in field_lower:
                    result['Proficiency_Level'] = value

        # Try "Field: Value" format
        colon_idx = clean.find(':')
        if colon_idx > 0 and colon_idx < 40:
            field = clean[:colon_idx].strip().lower()
            value = clean[colon_idx+1:].strip()
            if 'organisation' in field or 'training provider' in field:
                if not result['Name_of_Organisation']:
                    result['Name_of_Organisation'] = value
            elif 'course title' in field:
                if not result['Course_Title']:
                    result['Course_Title'] = value

    # Extract Learning Units from ## headers or LU patterns
    lu_pattern = re.compile(r'(?:LU\d+|Learning Unit \d+)[:\s]*(.+)', re.IGNORECASE)
    current_lu = None
    current_topics = []

    for line in lines:
        clean = line.replace('**', '').strip()
        lu_match = lu_pattern.search(clean)
        if lu_match or (clean.startswith('###') and 'LU' in clean.upper()):
            if current_lu:
                result['Learning_Units'].append(current_lu)
            title = lu_match.group(1).strip() if lu_match else clean.replace('###', '').strip()
            current_lu = {
                'LU_Title': title,
                'LO': '',
                'Topics': [],
                'K_numbering_description': [],
                'A_numbering_description': [],
                'Assessment_Methods': [],
                'Instructional_Methods': [],
            }
            current_topics = []
        elif current_lu:
            # Parse assessment methods for this LU
            if 'assessment method' in clean.lower() and ':' in clean:
                methods_str = clean.split(':', 1)[1].strip()
                for m in re.split(r'[,;]', methods_str):
                    m = m.strip()
                    if m:
                        current_lu['Assessment_Methods'].append(m)
            # Parse instructional methods for this LU
            elif 'instructional method' in clean.lower() and ':' in clean:
                methods_str = clean.split(':', 1)[1].strip()
                for m in re.split(r'[,;]', methods_str):
                    m = m.strip()
                    if m:
                        current_lu['Instructional_Methods'].append(m)
            # Parse topics
            if clean.startswith('- T') or (clean.startswith('T') and ':' in clean[:5]):
                topic_name = re.sub(r'^-?\s*T\d+[:\s]*', '', clean).strip()
                if topic_name:
                    current_lu['Topics'].append({'Topic_Title': topic_name, 'Bullet_Points': []})
            elif clean.startswith('- ') and current_lu['Topics']:
                current_lu['Topics'][-1]['Bullet_Points'].append(clean[2:].strip())
            # Parse K statements
            k_match = re.match(r'-?\s*(K\d+)[:\s]*(.+)', clean)
            if k_match:
                current_lu['K_numbering_description'].append({
                    'K_number': k_match.group(1),
                    'Description': k_match.group(2).strip()
                })
            # Parse A statements
            a_match = re.match(r'-?\s*(A\d+)[:\s]*(.+)', clean)
            if a_match:
                current_lu['A_numbering_description'].append({
                    'A_number': a_match.group(1),
                    'Description': a_match.group(2).strip()
                })
            # Parse LO
            lo_match = re.match(r'-?\s*(?:LO\d+)[:\s]*(.+)', clean, re.IGNORECASE)
            if lo_match:
                current_lu['LO'] = lo_match.group(1).strip()

    if current_lu:
        result['Learning_Units'].append(current_lu)

    # Extract Course Overview from text between headers
    overview_match = re.search(r'(?:Course Overview|What This Course Is About)\s*\n([\s\S]*?)(?:\n##|\n\*\*|$)', text, re.IGNORECASE)
    if overview_match:
        result['Course_Overview'] = overview_match.group(1).strip()[:2000]

    # Extract Assessment Methods Details from markdown table
    am_section = re.search(r'(?:Assessment Methods? (?:&|and) Duration|Assessment Methods? Details?)([\s\S]*?)(?:\n##|\n\*\*[A-Z]|$)', text, re.IGNORECASE)
    if am_section:
        table_lines = [l for l in am_section.group(1).split('\n') if '|' in l and '---' not in l]
        for line in table_lines[1:]:  # Skip header
            parts = [p.strip() for p in line.split('|') if p.strip()]
            if len(parts) >= 3:
                method = parts[0]
                abbr = parts[1] if len(parts) > 1 else get_method_abbr(method)
                duration = parts[2] if len(parts) > 2 else ''
                ratio = parts[3] if len(parts) > 3 else ''
                if method and not method.lower().startswith('assessment method'):
                    result['Assessment_Methods_Details'].append({
                        'Assessment_Method': method,
                        'Method_Abbreviation': abbr,
                        'Total_Delivery_Hours': duration,
                        'Assessor_to_Candidate_Ratio': [ratio] if ratio else [],
                    })

    return result


def build_context(data, doc_type):
    now = datetime.now()
    effective_date = now.strftime("%d %b %Y")

    # If data has 'extractedText', parse it as fallback
    extracted_text = data.get('extractedText', '')
    parsed_from_text = parse_extracted_text(extracted_text) if extracted_text else {}

    # Helper to get field from data or parsed text
    def f(*keys, default=''):
        for key in keys:
            val = data.get(key)
            if val:
                return val
        for key in keys:
            val = parsed_from_text.get(key)
            if val:
                return val
        return default

    tsc_code = f('TSC_Code', 'tscCode')
    sector_info = get_sector_info(tsc_code)

    context = {
        'Course_Title': f('Course_Title', 'courseTitle'),
        'TSC_Code': tsc_code,
        'TSC_Title': f('TSC_Title', 'tscTitle'),
        'TSC_Category': sector_info['sector'] or f('TSC_Category', 'TSC_Sector'),
        'TSC_Sector': sector_info['sector'] or f('TSC_Sector', 'TSC_Category'),
        'TSC_Sector_Abbr': sector_info['framework'] or f('Skills_Framework'),
        'Skills_Framework': sector_info['framework'] or f('Skills_Framework'),
        'Proficiency_Level': sector_info['level'] or f('Proficiency_Level'),
        'TSC_Description': f('TSC_Description', 'courseOverview', 'Course_Overview'),
        'Proficiency_Description': f('Proficiency_Description', 'TSC_Description', 'courseOverview', 'Course_Overview'),
        'Course_Overview': f('Course_Overview', 'courseOverview'),
        'LO_Description': f('LO_Description'),
        'TGS_Ref_No': f('TGS_Ref_No', 'tgsRefNo'),
        'Total_Training_Hours': f('Total_Training_Hours', 'totalTrainingHours'),
        'Total_Assessment_Hours': f('Total_Assessment_Hours', 'totalAssessmentHours'),
        'Total_Course_Duration_Hours': f('Total_Course_Duration_Hours'),
        'Name_of_Organisation': f('Name_of_Organisation', 'organisationName'),
        'UEN': f('UEN') or '201200696W',  # Default to Tertiary Infotech UEN
        'Rev_No': '1.0',
        'Effective_Date': effective_date,
        'Date': effective_date,
        'Year': str(now.year),
        'Author': '',
        'Reviewed_By': '',
        'Approved_By': '',
        'lesson_plan': '',
        'company_logo': '',
    }

    # Process Learning Units (from structured data or parsed text)
    learning_units = data.get('Learning_Units', data.get('learningUnits', parsed_from_text.get('Learning_Units', [])))
    processed_lus = []
    for lu in learning_units:
        methods = lu.get('Assessment_Methods', lu.get('assessmentMethods', []))
        method_abbrs = [get_method_abbr(m) for m in methods if m]

        lo_full = lu.get('LO', lu.get('learningOutcome', ''))
        # Extract short LO label (e.g., "ELO1" from "ELO1: Learners will be able to...")
        lo_label_match = re.match(r'(E?LO\d+)', lo_full)
        lo_label = lo_label_match.group(1) if lo_label_match else f"LO{len(processed_lus)+1}"

        processed_lu = {
            'LU_Title': lu.get('LU_Title', lu.get('luTitle', '')),
            'LO': lo_full,
            'LO_Label': lo_label,
            'Topics': [],
            'K_numbering_description': [],
            'A_numbering_description': [],
            # CRITICAL: Assessment_Methods must contain ABBREVIATIONS for template matrix logic
            'Assessment_Methods': method_abbrs,
            'Assessment_Methods_Full': methods,
            'Assessment_Methods_Abbr': ', '.join(method_abbrs),
            'Instructional_Methods': lu.get('Instructional_Methods', lu.get('instructionalMethods', [])),
        }

        for t in lu.get('Topics', lu.get('topics', [])):
            processed_lu['Topics'].append({
                'Topic_Title': t.get('Topic_Title', t.get('title', '')),
                'Bullet_Points': t.get('Bullet_Points', t.get('bulletPoints', [])),
            })

        for k in lu.get('K_numbering_description', lu.get('kStatements', [])):
            processed_lu['K_numbering_description'].append({
                'K_number': k.get('K_number', k.get('id', '')),
                'Description': k.get('Description', k.get('description', '')),
            })

        for a in lu.get('A_numbering_description', lu.get('aStatements', [])):
            processed_lu['A_numbering_description'].append({
                'A_number': a.get('A_number', a.get('id', '')),
                'Description': a.get('Description', a.get('description', '')),
            })

        processed_lus.append(processed_lu)

    # CRITICAL: Ensure ALL LUs have the assessment method abbreviations from Assessment_Methods_Details
    # This fixes the Knowledge/Ability matrix in AP template
    am_details = data.get('Assessment_Methods_Details', data.get('assessmentMethodsDetails', parsed_from_text.get('Assessment_Methods_Details', [])))
    all_method_abbrs = list(set([
        am.get('Method_Abbreviation', am.get('abbreviation', get_method_abbr(am.get('Assessment_Method', am.get('method', '')))))
        for am in am_details if am
    ]))

    for lu in processed_lus:
        # If LU has no assessment methods, assign all methods from Assessment_Methods_Details
        if not lu['Assessment_Methods']:
            lu['Assessment_Methods'] = all_method_abbrs
            lu['Assessment_Methods_Abbr'] = ', '.join(all_method_abbrs)
        # Also ensure abbreviations are used (not full names)
        fixed_methods = []
        for m in lu['Assessment_Methods']:
            abbr = get_method_abbr(m) if len(m) > 6 else m
            fixed_methods.append(abbr)
        lu['Assessment_Methods'] = list(set(fixed_methods))
        lu['Assessment_Methods_Abbr'] = ', '.join(lu['Assessment_Methods'])

    context['Learning_Units'] = processed_lus

    # Build Assessment Summary — use short LO labels (ELO1, LO1) and group by assessment methods
    # Matching Streamlit's concise format
    lo_methods_map = {}  # methods_str -> list of LO labels
    for i, lu in enumerate(processed_lus):
        lo_text = lu['LO']
        # Extract LO number: "ELO1: ...", "LO1: ...", or just use index
        lo_match = re.match(r'(E?LO\d+)', lo_text)
        lo_label = lo_match.group(1) if lo_match else f"LO{i+1}"
        methods_str = lu['Assessment_Methods_Abbr']
        if methods_str not in lo_methods_map:
            lo_methods_map[methods_str] = []
        lo_methods_map[methods_str].append(lo_label)

    context['Assessment_Summary'] = [
        {'LO': ', '.join(lo_labels), 'Assessment_Methods': methods}
        for methods, lo_labels in lo_methods_map.items()
    ]

    am_details = data.get('Assessment_Methods_Details', data.get('assessmentMethodsDetails', parsed_from_text.get('Assessment_Methods_Details', [])))
    context['Assessment_Methods_Details'] = [
        {
            'Assessment_Method': am.get('Assessment_Method', am.get('method', '')),
            'Method_Abbreviation': am.get('Method_Abbreviation', am.get('abbreviation', get_method_abbr(am.get('Assessment_Method', am.get('method', ''))))),
            'Total_Delivery_Hours': am.get('Total_Delivery_Hours', am.get('totalHours', '')),
            'Assessor_to_Candidate_Ratio': am.get('Assessor_to_Candidate_Ratio', []),
            'Evidence': am.get('Evidence', ''),
            'Submission': am.get('Submission', ''),
            'Marking_Process': am.get('Marking_Process', ''),
            'Retention_Period': am.get('Retention_Period', ''),
        }
        for am in am_details
    ]

    # Debug output
    print(json.dumps({
        'debug': True,
        'course_title': context['Course_Title'],
        'tgs_ref': context['TGS_Ref_No'],
        'org': context['Name_of_Organisation'],
        'num_lus': len(context['Learning_Units']),
        'num_am': len(context['Assessment_Methods_Details']),
    }), file=sys.stderr)

    return context


def generate_document(doc_type, context, output_path):
    template_file = TEMPLATES.get(doc_type)
    if not template_file:
        raise ValueError(f"Unknown document type: {doc_type}")

    template_path = os.path.join(TEMPLATE_DIR, template_file)
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Template not found: {template_path}")

    doc = DocxTemplate(template_path)

    # Add company logo (matching Streamlit's process_logo_image)
    logo_path = os.path.join(TEMPLATE_DIR, 'tertiary_logo.png')
    if os.path.exists(logo_path):
        try:
            context['company_logo'] = InlineImage(doc, logo_path, width=Mm(50))
        except Exception as e:
            print(f"Logo error: {e}", file=sys.stderr)
            context['company_logo'] = ''
    else:
        context['company_logo'] = ''

    doc.render(context, autoescape=True)
    doc.save(output_path)

    # Post-process: remove blank pages by walking body elements
    try:
        from docx import Document as _Doc
        from docx.oxml.ns import qn
        _doc = _Doc(output_path)
        body = _doc.element.body

        # Walk body elements
        elements = list(body)
        # Find page break elements and check if they lead to empty content
        for i, el in enumerate(elements):
            tag = el.tag.split('}')[-1] if '}' in el.tag else el.tag
            if tag != 'p':
                continue

            # Check for page breaks in this paragraph
            pagebreak_brs = []
            for br in el.findall('.//' + qn('w:br')):
                if br.get(qn('w:type')) == 'page':
                    pagebreak_brs.append(br)

            if not pagebreak_brs:
                continue

            # Look ahead: what's the next 3-5 elements?
            next_has_content = False
            empty_para_count = 0
            for j in range(i + 1, min(i + 8, len(elements))):
                next_el = elements[j]
                next_tag = next_el.tag.split('}')[-1] if '}' in next_el.tag else next_el.tag
                if next_tag == 'tbl':
                    next_has_content = True
                    break
                if next_tag == 'p':
                    t = ''.join(next_el.itertext()).strip()
                    if t and len(t) > 3:
                        next_has_content = True
                        break
                    empty_para_count += 1

            # If no content follows within 8 elements, remove page break
            if not next_has_content and empty_para_count >= 3:
                for br in pagebreak_brs:
                    br.getparent().remove(br)

        # Also remove excessive consecutive empty paragraphs
        paragraphs = list(_doc.paragraphs)
        to_remove = []
        empty_count = 0
        for p in paragraphs:
            if not p.text.strip():
                empty_count += 1
                if empty_count > 2:
                    to_remove.append(p)
            else:
                empty_count = 0
        for p in to_remove:
            p._element.getparent().remove(p._element)

        _doc.save(output_path)
    except Exception as e:
        print(f"Post-process warning: {e}", file=sys.stderr)

    return output_path


def main():
    if len(sys.argv) != 4:
        print(json.dumps({'error': 'Usage: fill-template.py <doc_type> <context_json_path> <output_path>'}))
        sys.exit(1)

    doc_type = sys.argv[1]
    context_json_path = sys.argv[2]
    output_path = sys.argv[3]

    try:
        with open(context_json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        context = build_context(data, doc_type)
        result_path = generate_document(doc_type, context, output_path)
        print(json.dumps({'success': True, 'path': result_path}))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
