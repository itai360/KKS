// The feedback after an experience as a Word file, laid out as the format on paper: the title, the cadet,
// the experience and its date in a table, the general reference, the points to keep and to improve with
// their axes, the legend and the score.
//
// Written right to left the way Word reads Hebrew: every paragraph and run marked right-to-left, the
// tables' first column on the right, and the bold and the sizes set for Hebrew text too (Word keeps
// separate ones for it - a bold or a size set for Latin text alone does not show on Hebrew). A4, 2 cm
// margins, Arial (on every computer and phone), hairline grey tables with a tinted head row, and the
// score's band marked in the legend.

import { POINT_LABELS, SCORE_BANDS, scoreBand, type ExperienceFeedbackForm, type FeedbackPoint, type PointKind } from './experienceFeedback';
import { zipStore } from './zip';

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface FeedbackDocument {
  cadetName: string;
  /** the experience: the role, or a broad experience's type */
  topic: string;
  /** its date, or its days, as the site writes them */
  date: string;
  form: ExperienceFeedbackForm;
  score: number | null;
}

// sizes in twentieths of a point (twips): an A4 page, 2 cm margins
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1134;
const WIDTH = PAGE_W - 2 * MARGIN;

const FONT = 'Arial';
const RULE = '1C3F7A';
const LINE = '8C8C8C';
const HEAD_FILL = 'E3E9F4';
const MARK_FILL = 'C9D6EC';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** text as XML: no characters XML cannot hold, and the five it reads as markup escaped */
const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface RunStyle {
  bold?: boolean;
  /** in points */
  size?: number;
}

/** a run of text, right to left; a line break in it stays one */
function run(text: string, s: RunStyle = {}): string {
  // the order Word's schema asks for: bold, size, direction
  const props = `${s.bold ? '<w:b/><w:bCs/>' : ''}${s.size ? `<w:sz w:val="${s.size * 2}"/><w:szCs w:val="${s.size * 2}"/>` : ''}<w:rtl/>`;
  const body = text
    .split('\n')
    .map((line) => `<w:t xml:space="preserve">${esc(line)}</w:t>`)
    .join('<w:br/>');
  return `<w:r><w:rPr>${props}</w:rPr>${body}</w:r>`;
}

interface ParaStyle {
  /** none: from the right, as Hebrew is read */
  align?: 'center' | 'both';
  /** space before and after, in twips */
  before?: number;
  after?: number;
  /** stays on the page of what comes after it (a heading and its table) */
  keepNext?: boolean;
  /** a line under it */
  rule?: boolean;
}

function para(runs: string, s: ParaStyle = {}): string {
  const spacing = s.before !== undefined || s.after !== undefined ? `<w:spacing${s.before !== undefined ? ` w:before="${s.before}"` : ''}${s.after !== undefined ? ` w:after="${s.after}"` : ''}/>` : '';
  const props =
    (s.keepNext ? '<w:keepNext/>' : '') +
    (s.rule ? `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="${RULE}"/></w:pBdr>` : '') +
    '<w:bidi/>' +
    spacing +
    (s.align ? `<w:jc w:val="${s.align}"/>` : '');
  return `<w:p><w:pPr>${props}</w:pPr>${runs}</w:p>`;
}

/** a table cell: its width, its paragraph (no space after it - the cell's margins are the room) */
function cell(width: number, runs: string, o: { fill?: string; center?: boolean } = {}): string {
  const fill = o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill}<w:vAlign w:val="center"/></w:tcPr>${para(runs, { after: 0, align: o.center ? 'center' : undefined })}</w:tc>`;
}

/** a row that is not split across pages; the head row repeats on the next page */
const row = (cells: string[], head = false) => `<w:tr><w:trPr><w:cantSplit/>${head ? '<w:tblHeader/>' : ''}</w:trPr>${cells.join('')}</w:tr>`;

/** a table the width of the page, its first column on the right, hairline grey borders */
function table(widths: number[], rows: string[]): string {
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="${LINE}"/>`).join('');
  const margins = '<w:top w:w="70" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="110" w:type="dxa"/>';
  return (
    `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders>` +
    `<w:tblLayout w:type="fixed"/><w:tblCellMar>${margins}</w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`
  );
}

/** the page's width cut into equal columns (the last takes what is left over) */
function columns(n: number): number[] {
  const w = Math.floor(WIDTH / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? WIDTH - w * (n - 1) : w));
}

/** a point: its kind and axis in bold, the point, and what was seen on the line under it */
function point(kind: PointKind, p: FeedbackPoint, first: boolean): string {
  const text = p.text.trim();
  return para(run(`${POINT_LABELS[kind]}: `, { bold: true }) + run(`(ציר: ${p.axis.trim()}) `, { bold: true }) + run(p.title.trim() + (text ? `\n${text}` : '')), {
    before: first ? 200 : 0,
    after: 100,
  });
}

function documentXml(d: FeedbackDocument): string {
  const band = d.score === null ? null : scoreBand(d.score);
  const details = columns(3);
  const legend = columns(SCORE_BANDS.length);
  const body = [
    para(run('משוב לאחר התנסות', { bold: true, size: 14 }), { after: 240, rule: true }),
    table(details, [
      row(
        ['שם הצוער', 'נושא ההתנסות', 'תאריך ההתנסות'].map((h, i) => cell(details[i], run(h, { bold: true }), { fill: HEAD_FILL })),
        true,
      ),
      row([d.cadetName, d.topic, d.date].map((v, i) => cell(details[i], run(v)))),
    ]),
    para(run('התייחסות כללית מילולית: ', { bold: true }) + run(d.form.general.trim()), { before: 280, align: 'both' }),
    ...(['keep', 'improve'] as const).flatMap((kind) => d.form[kind].filter((p) => p.title.trim()).map((p, i) => point(kind, p, i === 0))),
    para(run('מקרא הערכה להתנסות:', { bold: true }), { before: 280, keepNext: true }),
    table(legend, [
      row(
        SCORE_BANDS.map((b, i) => cell(legend[i], run(b.label, { bold: true, size: 10 }), { fill: b === band ? MARK_FILL : HEAD_FILL, center: true })),
        true,
      ),
      row(SCORE_BANDS.map((b, i) => cell(legend[i], run(b.range, { bold: b === band, size: 10 }), { fill: b === band ? MARK_FILL : undefined, center: true }))),
    ]),
    para(run('ציון להתנסות: ', { bold: true }) + (d.score === null ? '' : run(String(d.score), { bold: true, size: 13 }) + run(` (${band?.label})`)), { before: 280 }),
  ].join('');
  const section = `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/><w:bidi/></w:sectPr>`;
  return `${XML}<w:document xmlns:w="${W}"><w:body>${body}${section}</w:body></w:document>`;
}

// Arial 12 for Hebrew and Latin alike, the text marked Hebrew (Word checks its spelling as Hebrew),
// paragraphs right to left with a little room after each and 1.15 lines
const STYLES =
  `${XML}<w:styles xmlns:w="${W}"><w:docDefaults>` +
  `<w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="he-IL" w:eastAsia="en-US" w:bidi="he-IL"/></w:rPr></w:rPrDefault>` +
  '<w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

const SETTINGS =
  `${XML}<w:settings xmlns:w="${W}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>` +
  '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
  '<w:themeFontLang w:val="en-US" w:bidi="he-IL"/></w:settings>';

const CONTENT_TYPES =
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELS =
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
const DOCUMENT_RELS =
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/settings" Target="settings.xml"/></Relationships>`;

const core = (title: string) =>
  `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
  `<dc:title>${esc(title)}</dc:title><dc:language>he-IL</dc:language></cp:coreProperties>`;

/** the feedback as a .docx file */
export function feedbackDocx(d: FeedbackDocument): Uint8Array {
  return zipStore([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: PACKAGE_RELS },
    { name: 'word/document.xml', data: documentXml(d) },
    { name: 'word/_rels/document.xml.rels', data: DOCUMENT_RELS },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/settings.xml', data: SETTINGS },
    { name: 'docProps/core.xml', data: core(`משוב לאחר התנסות - ${d.cadetName}`) },
  ]);
}

/** the file's name: the format, the cadet and the experience - nothing a file name cannot hold */
export function feedbackDocName(cadetName: string, topic: string): string {
  const name = `משוב לאחר התנסות - ${cadetName} - ${topic}`
    // מ"מ keeps its marks, as the Hebrew ones a file name can hold
    .replace(/"/g, '״')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?<>|\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${name}.docx`;
}
