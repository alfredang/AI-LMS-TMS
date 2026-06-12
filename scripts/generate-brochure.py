"""
Brochure Generator — mirrors Streamlit courseware_autogen brochure_generation_v2.py.

Scrapes a course URL, populates the brochure HTML template, and outputs a PDF
using Playwright.

Usage: python generate-brochure.py <url> <template_dir> <output_pdf_path>
Outputs: JSON status to stdout with course_title, tgs_ref, and pdf_path.
"""

import sys
import json
import os
import re
import traceback
from pathlib import Path

import requests
from bs4 import BeautifulSoup

FRAMEWORK_MAPPING = {
    'ACC': 'Accountancy', 'RET': 'Retail', 'MED': 'Media', 'ICT': 'Infocomm Technology',
    'BEV': 'Built Environment', 'DSN': 'Design', 'DNS': 'Design', 'AGR': 'Agriculture',
    'ELE': 'Electronics', 'LOG': 'Logistics', 'STP': 'Sea Transport', 'TOU': 'Tourism',
    'AER': 'Aerospace', 'ATP': 'Air Transport', 'BPM': 'BioPharmaceuticals Manufacturing',
    'ECM': 'Energy and Chemicals', 'EGS': 'Engineering Services', 'EPW': 'Energy and Power',
    'EVS': 'Environmental Services', 'FMF': 'Food Manufacturing', 'FSE': 'Financial Services',
    'FSS': 'Food Services', 'HAS': 'Hotel and Accommodation Services', 'HCE': 'Healthcare',
    'HRS': 'Human Resource', 'INP': 'Intellectual Property', 'LNS': 'Landscape',
    'MAR': 'Marine and Offshore', 'PRE': 'Precision Engineering', 'PTP': 'Public Transport',
    'SEC': 'Security', 'SSC': 'Social Service', 'TAE': 'Training and Adult Education',
    'WPH': 'Workplace Safety and Health', 'WST': 'Wholesale Trade',
    'ECC': 'Early Childhood Care and Education', 'ART': 'Arts',
}

TSC_CODE_RE = r'[A-Z]{3}-[A-Z]{3}-[0-9]+-[0-9\.]+(?:-[0-9]+)?'


def fetch_soup(url: str) -> BeautifulSoup:
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                     '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    return BeautifulSoup(r.content, 'html.parser')


def extract_course_title(soup):
    for sel in ['h1', '.course-title', '.title', '.page-title', 'title']:
        el = soup.select_one(sel)
        if el:
            title = el.get_text().strip()
            if title and len(title) > 10:
                if not title.startswith('WSQ'):
                    title = f"WSQ - {title}"
                return title
    return "WSQ - Course Title Not Found"


def extract_course_description(soup):
    descriptions = []
    for sel in ['.short-description p', '.product-description p', '.course-description p',
                '.description p', 'p']:
        for el in soup.select(sel):
            text = el.get_text().strip()
            if len(text) > 100 and any(w in text.lower() for w in ['course', 'designed', 'professional', 'learn', 'training']):
                descriptions.append(text)
                if len(descriptions) >= 2:
                    break
        if descriptions:
            break
    if not descriptions:
        descriptions = [
            "This advanced course is designed for professionals to build practical skills and confidence in the subject area.",
            "Participants will gain hands-on experience with industry-relevant techniques and best practices."
        ]
    return descriptions[:2]


def extract_learning_outcomes(soup):
    outcomes = []
    headings = soup.find_all(['h2', 'h3', 'h4'])
    for h in headings:
        if any(t in h.get_text().lower() for t in ['learning outcome', 'what you', 'objectives', 'you will learn']):
            nxt = h.find_next(['ul', 'ol'])
            if nxt:
                for li in nxt.find_all('li'):
                    text = li.get_text().strip()
                    if len(text) > 20:
                        if not text.endswith('.'):
                            text += '.'
                        outcomes.append(text)
                break
    if not outcomes:
        outcomes = [
            "Apply core concepts and methodologies to relevant workplace scenarios.",
            "Analyse practical implementation techniques for the topic area.",
            "Evaluate outcomes and improve processes based on learning."
        ]
    return outcomes[:6]


def extract_tsc_code(soup):
    text = soup.get_text()
    for pattern in [
        rf'({TSC_CODE_RE})\s+(?:Level\s+[0-9]+\s*)?TSC',
        rf'guideline.*?of.*?({TSC_CODE_RE})',
        rf'follows.*?({TSC_CODE_RE})',
        rf'TSC[:\s]+({TSC_CODE_RE})',
        rf'({TSC_CODE_RE})',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return "Not Applicable"


def extract_tsc_title(soup):
    text = soup.get_text()
    for pattern in [
        rf'follows.*?guideline.*?of\s+{TSC_CODE_RE}:\s+([\w\s&-]+?)\s+under\s+.+?Skills\s+Framework',
        rf'guideline of\s+({TSC_CODE_RE}):\s+(.*?)\s+under\s+.+?Skills',
        rf'({TSC_CODE_RE}):\s+([\w\s&-]+?)\s+under\s+.+?Skills\s+Framework',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            groups = m.groups()
            return groups[-1].strip() if groups else "Not Applicable"
    return "Not Applicable"


def extract_framework(soup, tsc_code):
    text = soup.get_text()
    patterns = [
        rf'under\s+([A-Z][A-Za-z\s&]+?)\s+Skills?\s+Framework',
        rf'{TSC_CODE_RE}.*?TSC.*?under\s+([\w\s&]+?)\s+Skills?\s+Framework',
    ]
    invalid = {'and', 'the', 'of', 'by', 'certification', 'above', 'statement', 'from', 'that', 'they', 'have', 'achieved'}
    for pattern in patterns:
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if m:
            fw = re.sub(r'\s+', ' ', m.group(1).strip()).replace('&amp;', '&')
            if len(fw) > 2 and fw.lower() not in invalid:
                return fw
    if tsc_code and tsc_code != "Not Applicable":
        prefix = tsc_code.split('-')[0]
        if prefix in FRAMEWORK_MAPPING:
            return FRAMEWORK_MAPPING[prefix]
    return "Not Applicable"


def extract_tgs_reference(soup):
    for span in soup.find_all('span', class_='value'):
        t = span.get_text().strip()
        if re.match(r'^TGS-\d{10}$', t):
            return t
    text = soup.get_text()
    for pattern in [
        r'Course Code[:\s]+(TGS-\d{10})',
        r'TGS Reference[:\s]+(TGS-\d{10})',
        r'\b(TGS-\d{10})\b',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return "TGS-Not Available"


def extract_fee_before_gst(soup):
    text = soup.get_text()
    for pattern in [
        r'\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*GST[- ]exclusive',
        r'\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:Bef|Before)\s*\.?\s*GST',
        r'\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:excl|excluding)\s*\.?\s*GST',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            amt = m.group(1).replace(',', '')
            return f"${amt}" if '.' in amt else f"${amt}.00"
    return "$900.00"


def extract_fee_with_gst(soup):
    text = soup.get_text()
    for pattern in [
        r'\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*GST[- ]inclusive',
        r'\$\s*(\d+(?:,\d+)?(?:\.\d{2})?)\s*\(?\s*(?:Incl|Including)\s*\.?\s*GST',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            amt = m.group(1).replace(',', '')
            return f"${amt}" if '.' in amt else f"${amt}.00"
    before = extract_fee_before_gst(soup)
    try:
        amt = float(before.replace('$', '').replace(',', ''))
        return f"${amt * 1.09:.2f}"
    except Exception:
        return "$981.00"


def extract_wsq_funding(soup):
    funding = {"Effective Date": "Not Available", "Full Fee": "Not Available",
               "GST": "Not Available", "Baseline": "Not Available", "MCES / SME": "Not Available"}
    full_text = soup.get_text()
    date_m = re.search(r'Effective for Courses starting from (\d{1,2}\s+\w+\s+\d{4})', full_text, re.IGNORECASE)
    if date_m:
        funding['Effective Date'] = date_m.group(1)
    for table in soup.find_all('table'):
        table_text = table.get_text()
        if all(t in table_text for t in ['Full', 'Fee', 'GST', 'Baseline', 'MCES']):
            for row in table.find_all('tr'):
                dollars = re.findall(r'\$(\d+(?:,\d+)?(?:\.\d{2})?)', row.get_text())
                if len(dollars) >= 4:
                    funding['Full Fee'] = f"${dollars[0]}"
                    funding['GST'] = f"${dollars[1]}"
                    funding['Baseline'] = f"${dollars[2]}"
                    funding['MCES / SME'] = f"${dollars[3]}"
                    break
            if funding['Full Fee'] != "Not Available":
                break
    return funding


def extract_session_days(soup):
    text = soup.get_text()
    for pattern in [
        r'Session\s*\(days\)[:\s]*(\d+)',
        r'Session[:\s]+(\d+)\s*days?',
        r'(\d+)\s*days?\s*session',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return "2"


def extract_duration_hrs(soup):
    text = soup.get_text()
    for pattern in [
        r'Duration\s*\(hrs\)[:\s]*(\d+)',
        r'Duration[:\s]+(\d+)\s*hrs?',
        r'(\d+)\s*hrs?\s*duration',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return "16"


def extract_course_topics(soup):
    """Extract LU/Topic sections with subtopics."""
    topics = []
    for strong in soup.find_all('strong'):
        text = strong.get_text().strip()
        lu_m = re.match(r'^LU\s*(\d+):\s*(.+)', text)
        topic_m = re.match(r'^Topic\s+(\d+)\s*[:\-]?\s*(.+)', text, re.IGNORECASE)
        if not (lu_m or topic_m):
            continue
        lu_title = text
        subtopics = []
        p_tag = strong.parent
        if not p_tag or p_tag.name != 'p':
            continue
        current = p_tag
        for _ in range(50):
            current = current.find_next_sibling()
            if not current:
                break
            cur_text = current.get_text().strip()
            if current.find('strong'):
                s_text = current.find('strong').get_text().strip()
                if re.match(r'^LU\s*\d+:', s_text) or re.match(r'^Topic\s+\d+', s_text, re.IGNORECASE):
                    break
            if any(t in cur_text.lower() for t in ['minimum entry requirement', 'entry requirement', 'knowledge and skills']):
                break
            skip_terms = ['written assessment', 'wa-saq', 'practical performance', 'pp)', '(pp']
            if current.name == 'p' and re.match(r'^T\d+\.', cur_text):
                if not any(t in cur_text.lower() for t in skip_terms):
                    subtopics.append(cur_text)
            elif current.name == 'p' and '•' in cur_text:
                for b in cur_text.split('•')[1:]:
                    b = b.strip()
                    if len(b) > 15 and not any(t in b.lower() for t in skip_terms):
                        subtopics.append(b)
            elif current.name == 'ul':
                for li in current.find_all('li', recursive=False):
                    li_text = li.get_text().strip()
                    if len(li_text) > 10 and not any(t in li_text.lower() for t in skip_terms):
                        subtopics.append(li_text)
            elif current.name == 'p' and re.search(r'T\d+:', cur_text):
                if current.find_all('br'):
                    parts = re.split(r'<br\s*/?>', str(current))
                    for part in parts:
                        pt = BeautifulSoup(part, 'html.parser').get_text().strip()
                        if re.match(r'^T\d+:', pt) and len(pt) > 10 and not any(t in pt.lower() for t in skip_terms):
                            subtopics.append(pt)
                elif re.match(r'^T\d+:', cur_text) and not any(t in cur_text.lower() for t in skip_terms):
                    subtopics.append(cur_text)
        if subtopics:
            topics.append({'title': lu_title, 'subtopics': subtopics})
    if not any('final assessment' in t['title'].lower() for t in topics):
        topics.append({'title': 'Final Assessment', 'subtopics': []})
    return topics


def scrape_course(url: str) -> dict:
    soup = fetch_soup(url)
    tsc_code = extract_tsc_code(soup)
    return {
        'course_title': extract_course_title(soup),
        'course_description': extract_course_description(soup),
        'learning_outcomes': extract_learning_outcomes(soup),
        'tsc_title': extract_tsc_title(soup),
        'tsc_code': tsc_code,
        'tsc_framework': extract_framework(soup, tsc_code),
        'wsq_funding': extract_wsq_funding(soup),
        'tgs_reference_no': extract_tgs_reference(soup),
        'gst_exclusive_price': extract_fee_before_gst(soup),
        'gst_inclusive_price': extract_fee_with_gst(soup),
        'session_days': extract_session_days(soup),
        'duration_hrs': extract_duration_hrs(soup),
        'course_details_topics': extract_course_topics(soup),
        'course_url': url,
    }


def populate_template(template_html: str, data: dict) -> str:
    html = template_html
    title = data['course_title']

    # Title (appears in h1s and <title>)
    html = html.replace('WSQ - Design and Build Responsive Websites from Scratch', title)

    # About course paragraphs
    descs = data['course_description']
    old_p1 = ("Elevate your web development skills with our course on Responsive Web Interface Design "
              "using Bootstrap. This course equips you with the knowledge and practical skills to build "
              "visually appealing and highly functional web interfaces. You'll learn how to use Bootstrap's "
              "grid system, components, and utilities to design layouts that adapt seamlessly to various "
              "screen sizes. The course covers essential concepts like navigation bars, form controls, and "
              "responsive typography, ensuring you can create professional-quality websites.")
    old_p2 = ("In addition to the core Bootstrap components, this course also delves into best practices "
              "for user experience (UX) design. You'll understand how to conduct basic usability tests, "
              "apply responsive design patterns, and optimize site performance. These complementary skills "
              "will enable you to create web interfaces that not only look good but also provide an "
              "exceptional user experience, making you a more versatile and employable front-end developer.")
    if len(descs) >= 1:
        html = html.replace(old_p1, descs[0])
    if len(descs) >= 2:
        html = html.replace(old_p2, descs[1])

    # Learning outcomes
    outcomes = data['learning_outcomes']
    if outcomes:
        new_block = '\n'.join(
            f'            <li>{re.sub(r"LO\\d+:", "", o).strip().rstrip(".")}.</li>'
            for o in outcomes
        )
        old_block = (
            '            <li>Identify Bootstrap framework functionalities and information flows for responsive web interface.</li>\n'
            '            <li>Develop components and design GUI.</li>\n'
            '            <li>Evaluate the web responsiveness and interactivity.</li>\n'
            '            <li>Apply Bootstrap framework to update single page design.</li>'
        )
        html = html.replace(old_block, new_block)

    # Course outline table
    topics = data['course_details_topics']
    if topics:
        rows = []
        for t in topics:
            t_title = t['title']
            t_subs = t.get('subtopics', [])
            rows.append(f'                    <tr>')
            rows.append(f'                        <td class="topic-header"><strong>{t_title}</strong></td>')
            rows.append(f'                    </tr>')
            if t_subs and 'final assessment' not in t_title.lower():
                formatted = [f"T{i+1}: {re.sub(r'^T\\d+[:.\\s]*', '', s).strip()}" for i, s in enumerate(t_subs)]
                joined = '<br>\n                        '.join(formatted)
                rows.append(f'                    <tr>')
                rows.append(f'                        <td class="topic-content">{joined}</td>')
                rows.append(f'                    </tr>')
        old_table = (
            '                    <tr>\n'
            '                        <td class="topic-header"><strong>LU1: Overview of Responsive Web Interface Design and Bootstrap</strong></td>\n'
            '                    </tr>\n'
            '                    <tr>\n'
            '                        <td class="topic-content">T1: What is Responsive Web Design?<br>\n'
            '                        T2: Introduction to Bootstrap Framework<br>\n'
            '                        T3: Create Responsive Web Layout using Bootstrap</td>\n'
            '                    </tr>\n'
            '                    <tr>\n'
            '                        <td class="topic-header"><strong>LU2: Components and Graphics Content</strong></td>\n'
            '                    </tr>\n'
            '                    <tr>\n'
            '                        <td class="topic-content">T1: Create Basic Bootstrap Components<br>\n'
            '                        T2: Design GUI with Style and Content Elements</td>\n'
            '                    </tr>\n'
            '                    <tr>\n'
            '                        <td class="topic-header"><strong>LU3: Interactivity and Responsiveness</strong></td>\n'
            '                    </tr>\n'
            '                    <tr>\n'
            '                        <td class="topic-content">T1: Create Interactive Components<br>\n'
            '                        T2: Apply Bootstrap Utilities<br>\n'
            '                        T3: Evaluate Web Interface Interactivity and Responsiveness</td>\n'
            '                    </tr>\n'
            '                    <tr>\n'
            '                        <td class="topic-header"><strong>LU4: Single Page Design</strong></td>\n'
            '                    </tr>\n'
            '                    <tr>\n'
            '                        <td class="topic-content">T1: Web Design Requirement for Single Page<br>\n'
            '                        T2: Implement Single Page Design</td>\n'
            '                    </tr>\n'
            '                    <tr>\n'
            '                        <td class="topic-header"><strong>Final Assessment</strong></td>\n'
            '                    </tr>'
        )
        html = html.replace(old_table, '\n'.join(rows))

    # Course info
    html = html.replace('TGS-2021002504', data['tgs_reference_no'])

    tsc_title = data.get('tsc_title', '').replace('Not Applicable', '').strip()
    tsc_code = data.get('tsc_code', '').replace('Not Applicable', '').strip()
    framework = data.get('tsc_framework', 'ICT').replace('Not Applicable', '').strip() or 'ICT'
    if tsc_title and tsc_code:
        new_sf = f"<strong>{tsc_title} {tsc_code} TSC</strong> under {framework} Skills Framework"
    elif tsc_code:
        new_sf = f"<strong>{tsc_code} TSC</strong> under {framework} Skills Framework"
    else:
        new_sf = f"<strong>TSC</strong> under {framework} Skills Framework"
    html = html.replace(
        '<strong>User Interface Design ICT-DES-3008-1.1 TSC</strong> under ICT Skills Framework',
        new_sf
    )

    # Fees
    html = html.replace('$750.00 (Bef. GST)', f"{data['gst_exclusive_price']} (Bef. GST)")
    html = html.replace('$817.50 (Incl. GST)', f"{data['gst_inclusive_price']} (Incl. GST)")

    # Duration
    html = html.replace('16hrs (2 days)', f"{data['duration_hrs']}hrs ({data['session_days']} days)")

    # Registration link
    html = html.replace(
        'https://www.tertiarycourses.com.sg/wsq-bootstrap-web-design.html',
        data['course_url']
    )

    # Funding table
    funding = data['wsq_funding']
    if funding.get('Full Fee', 'Not Available') != 'Not Available':
        html = html.replace('$750', funding['Full Fee'].replace('.00', ''))
        html = html.replace('$67.50', funding.get('GST', '$81.00'))
        html = html.replace('$442.50', funding.get('Baseline', '$531.00'))
        html = html.replace('$292.50', funding.get('MCES / SME', '$351.00'))

    return html


def generate_pdf(html_content: str, template_dir: Path, output_path: str) -> bool:
    """Render HTML to PDF via Playwright so images and CSS load correctly."""
    from playwright.sync_api import sync_playwright

    tmp_html = template_dir / f"_tmp_brochure_{os.getpid()}.html"
    tmp_html.write_text(html_content, encoding='utf-8')
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(tmp_html.as_uri(), wait_until='networkidle')
            page.pdf(
                path=output_path,
                format='A4',
                margin={'top': '25px', 'right': '20px', 'bottom': '0px', 'left': '20px'},
                print_background=True,
                prefer_css_page_size=True,
            )
            browser.close()
        return True
    finally:
        try:
            tmp_html.unlink()
        except Exception:
            pass


def main():
    try:
        if len(sys.argv) < 4:
            print(json.dumps({'error': 'Usage: generate-brochure.py <url> <template_dir> <output_pdf>'}))
            return
        url = sys.argv[1]
        template_dir = Path(sys.argv[2]).resolve()
        output_pdf = str(Path(sys.argv[3]).resolve())

        template_path = template_dir / 'brochure.html'
        if not template_path.exists():
            print(json.dumps({'error': f'Template not found: {template_path}'}))
            return

        data = scrape_course(url)
        template_html = template_path.read_text(encoding='utf-8')
        populated = populate_template(template_html, data)
        ok = generate_pdf(populated, template_dir, output_pdf)
        if not ok:
            print(json.dumps({'error': 'PDF generation failed'}))
            return

        print(json.dumps({
            'success': True,
            'course_title': data['course_title'],
            'tgs_ref': data['tgs_reference_no'],
            'pdf_path': output_pdf,
            'course_data': {
                'tsc_code': data['tsc_code'],
                'tsc_title': data['tsc_title'],
                'tsc_framework': data['tsc_framework'],
                'duration_hrs': data['duration_hrs'],
                'session_days': data['session_days'],
                'gst_exclusive_price': data['gst_exclusive_price'],
                'gst_inclusive_price': data['gst_inclusive_price'],
                'num_topics': len(data['course_details_topics']),
                'num_outcomes': len(data['learning_outcomes']),
            }
        }))
    except Exception as e:
        print(json.dumps({'error': str(e), 'trace': traceback.format_exc()}))


if __name__ == '__main__':
    main()
