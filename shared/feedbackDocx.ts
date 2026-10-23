// The feedback after an experience as a Word file, laid out as the format on paper: the title, the cadet,
// the experience and its date in a table, the general reference, the points to keep and to improve with
// their axes, the legend with the score's band marked, and the score (shared/docx.ts writes it the way
// Word reads Hebrew). An experience not yet given its feedback comes as the same form with its details
// filled in and the rest left to write.

import { docxFile, fileName, HEAD_FILL, MARK_FILL, columns, cell, para, row, run, table } from './docx';
import { FEEDBACK_POINTS, POINT_LABELS, SCORE_BANDS, scoreBand, type ExperienceFeedbackForm, type FeedbackPoint, type PointKind } from './experienceFeedback';

export { DOCX_TYPE } from './docx';

export interface FeedbackDocument {
  cadetName: string;
  /** the experience: the role, or a broad experience's type */
  topic: string;
  /** its date, or its days, as the site writes them */
  date: string;
  /** null: not given yet - the form to fill in */
  form: ExperienceFeedbackForm | null;
  score: number | null;
}

/** a point: its kind and axis in bold, the point, and what was seen on the line under it */
function point(kind: PointKind, p: FeedbackPoint, first: boolean): string {
  const text = p.text.trim();
  return para(run(`${POINT_LABELS[kind]}: `, { bold: true }) + run(`(ציר: ${p.axis.trim()}) `, { bold: true }) + run(p.title.trim() + (text ? `\n${text}` : '')), {
    before: first ? 200 : 0,
    after: 100,
  });
}

/** an empty point, to write by hand or in Docs */
function blankPoint(kind: PointKind, first: boolean): string {
  return para(run(`${POINT_LABELS[kind]}: `, { bold: true }) + run('(ציר:                    ) ', { bold: true }) + run('\n '), { before: first ? 200 : 0, after: 160 });
}

function body(d: FeedbackDocument): string {
  const band = d.score === null ? null : scoreBand(d.score);
  const details = columns(3);
  const legend = columns(SCORE_BANDS.length);
  const form = d.form;
  return [
    para(run('משוב לאחר התנסות', { bold: true, size: 14 }), { after: 240, rule: true }),
    table(details, [
      row(
        ['שם הצוער', 'נושא ההתנסות', 'תאריך ההתנסות'].map((h, i) => cell(details[i], run(h, { bold: true }), { fill: HEAD_FILL })),
        true,
      ),
      row([d.cadetName, d.topic, d.date].map((v, i) => cell(details[i], run(v)))),
    ]),
    para(run('התייחסות כללית מילולית: ', { bold: true }) + run(form ? form.general.trim() : '\n\n '), { before: 280, align: form ? 'both' : undefined }),
    ...(['keep', 'improve'] as const).flatMap((kind) =>
      form ? form[kind].filter((p) => p.title.trim()).map((p, i) => point(kind, p, i === 0)) : Array.from({ length: FEEDBACK_POINTS }, (_, i) => blankPoint(kind, i === 0)),
    ),
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
}

/** the feedback as a .docx file */
export function feedbackDocx(d: FeedbackDocument): Uint8Array {
  return docxFile(`משוב לאחר התנסות - ${d.cadetName}`, body(d));
}

/** the file's name: the format, the cadet and the experience */
export const feedbackDocName = (cadetName: string, topic: string) => fileName(`משוב לאחר התנסות - ${cadetName} - ${topic}`, 'docx');
