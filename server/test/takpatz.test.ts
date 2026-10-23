// The takpatz (תקפ"צ): a team commander keeps their own team's only - reading, changing, exporting and
// saving to Drive, whatever the address - and the course commander every team's; the plans, the
// tracking, the thirds and the spreadsheet. The names here are made up.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOARD_SHEET_NAMES } from '../../shared/takpatz';
import { db } from '../src/db';
import { setDriveFetch } from '../src/googleDrive';
import { login, setup, staffMay, type Agent, type Ctx } from './helpers';

let c: Ctx;
let team1 = 0;
let team2 = 0;
const ids: Record<string, number> = {};

beforeEach(async () => {
  c = await setup();
  team1 = (await c.cmd.post('/api/teams', { name: 'צוות אלון', commanderId: c.ids.s1 })).body[0].id;
  team2 = (await c.cmd.post('/api/teams', { name: 'צוות ברוש', commanderId: c.ids.s2 })).body.find((t: { name: string }) => t.name === 'צוות ברוש').id;
  const add = async (first: string, last: string, team: number) => {
    ids[first] = (await c.cmd.post('/api/cadets', { firstName: first, lastName: last, personalNumber: '', teamId: team })).body.cadet.id;
  };
  for (const [f, l] of [['אביב', 'שקד'], ['גלעד', 'רימון'], ['דורית', 'אלה']]) await add(f, l, team1);
  for (const [f, l] of [['הדר', 'תמר'], ['ורד', 'זית']]) await add(f, l, team2);
});

afterEach(() => {
  setDriveFetch(null);
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

const place = (agent: Agent, body: Record<string, unknown>) => agent.post('/api/takpatz/placements', { board: 'main', category: 'command_team', label: 'ממ"ש שטח', weekFrom: 1, weekTo: 1, ...body });

describe('who keeps which takpatz', () => {
  it('a team commander their own team, the commander every team, anyone else none', async () => {
    expect((await c.s1.get('/api/takpatz')).body).toMatchObject({ scope: 'team', teams: [{ id: team1, name: 'צוות אלון' }] });
    expect((await c.s1.get('/api/takpatz')).body.teams).toHaveLength(1);
    expect((await c.s3.get('/api/takpatz')).body).toEqual({ scope: 'none', teams: [] });
    expect((await c.cmd.get('/api/takpatz')).body.teams.map((t: { id: number }) => t.id).sort()).toEqual([team1, team2].sort());
    const view = (await c.s1.get(`/api/takpatz/teams/${team1}`)).body;
    expect(view.cadets.map((x: { name: string }) => x.name)).toEqual(['אביב שקד', 'גלעד רימון', 'דורית אלה']);
    expect(view.canManageCatalog).toBe(false);
    expect((await c.cmd.get(`/api/takpatz/teams/${team1}`)).body.canManageCatalog).toBe(true);
  });

  it("another team's takpatz stays closed by every address - also when the commander opened the files of every team", async () => {
    const theirs = (await place(c.s2, { cadetId: ids['הדר'] })).body.id;
    for (const agent of [c.s1, c.s3]) {
      expect((await agent.get(`/api/takpatz/teams/${team2}`)).status).toBe(403);
      expect((await agent.patch(`/api/takpatz/cadets/${ids['הדר']}`, { notes: 'x' })).status).toBe(403);
      expect((await place(agent, { cadetId: ids['הדר'], weekFrom: 3, weekTo: 3 })).status).toBe(403);
      expect((await agent.patch(`/api/takpatz/placements/${theirs}`, { label: 'x' })).status).toBe(403);
      expect((await agent.del(`/api/takpatz/placements/${theirs}`)).status).toBe(403);
      expect((await agent.post(`/api/takpatz/placements/${theirs}/copy`, { to: 'alt' })).status).toBe(403);
      expect((await agent.put('/api/takpatz/stages', { placementId: theirs, stage: 'exec', status: 'done' })).status).toBe(403);
      expect((await agent.post('/api/takpatz/tracking', { cadetId: ids['הדר'], label: 'x' })).status).toBe(403);
      expect((await agent.post(`/api/takpatz/teams/${team2}/copy-board`, { from: 'main', to: 'alt' })).status).toBe(403);
      expect((await agent.get(`/api/takpatz/teams/${team2}/export`)).status).toBe(403);
      expect((await agent.post(`/api/takpatz/teams/${team2}/drive`)).status).toBe(403);
    }
    await staffMay(c, { cadetFiles: true });
    expect((await c.s1.get(`/api/takpatz/teams/${team2}`)).status).toBe(403);
    expect((await c.s1.get('/api/takpatz')).body.teams).toHaveLength(1);
    // nothing of theirs changed; the commander keeps it
    expect(db().get<{ label: string }>('SELECT label FROM takpatz_placements WHERE id = ?', theirs)!.label).toBe('ממ"ש שטח');
    expect((await c.cmd.patch(`/api/takpatz/placements/${theirs}`, { label: 'ממ"ש היסוד' })).status).toBe(200);
  });

  it('a cadet moved to another team takes their takpatz along - and out of the old commander’s reach', async () => {
    await c.s1.patch(`/api/takpatz/cadets/${ids['אביב']}`, { goals: ['קבלת החלטות', '', ''] });
    await c.cmd.patch(`/api/cadets/${ids['אביב']}`, { teamId: team2 });
    expect((await c.s1.patch(`/api/takpatz/cadets/${ids['אביב']}`, { notes: 'x' })).status).toBe(403);
    const view = (await c.s2.get(`/api/takpatz/teams/${team2}`)).body;
    expect(view.cadets.find((x: { id: number }) => x.id === ids['אביב']).goals[0]).toBe('קבלת החלטות');
  });

  it('the catalog is the commander’s', async () => {
    expect((await c.s1.post('/api/takpatz/catalog', { half: 1, kind: 'command_team', name: 'ממ"ש חדש' })).status).toBe(403);
    const list = (await c.cmd.post('/api/takpatz/catalog', { half: 1, kind: 'command_team', name: 'ממ"ש חדש' })).body;
    expect(list.some((x: { name: string }) => x.name === 'ממ"ש חדש')).toBe(true);
  });
});

describe("a cadet's own details", () => {
  it('goals, notes and ideas are kept and read back; the third and rank with when and by whom', async () => {
    const saved = (await c.s1.patch(`/api/takpatz/cadets/${ids['גלעד']}`, { goals: ['ביטחון עצמי', 'העברת מסרים', ''], notes: 'רוחב ב?', ideas: 'מ"כ ניווטים', third: 'upper', rank: 2 })).body;
    expect(saved).toMatchObject({ goals: ['ביטחון עצמי', 'העברת מסרים', ''], notes: 'רוחב ב?', third: 'upper', rank: 2, thirdUpdatedByName: 'מפק"צ 1' });
    const again = (await (await login(c.app, 's1')).get(`/api/takpatz/teams/${team1}`)).body.cadets.find((x: { id: number }) => x.id === ids['גלעד']);
    expect(again).toMatchObject({ goals: ['ביטחון עצמי', 'העברת מסרים', ''], ideas: 'מ"כ ניווטים', rank: 2 });
    // a partial change leaves the rest
    await c.s1.patch(`/api/takpatz/cadets/${ids['גלעד']}`, { notes: '' });
    expect((await c.s1.get(`/api/takpatz/teams/${team1}`)).body.cadets.find((x: { id: number }) => x.id === ids['גלעד']).goals[1]).toBe('העברת מסרים');
  });

  it('a rank already given asks first, and is given once confirmed', async () => {
    await c.s1.patch(`/api/takpatz/cadets/${ids['אביב']}`, { rank: 1 });
    const r = await c.s1.patch(`/api/takpatz/cadets/${ids['גלעד']}`, { rank: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('אביב שקד');
    expect((await c.s1.patch(`/api/takpatz/cadets/${ids['גלעד']}`, { rank: 1, allowDuplicateRank: true })).status).toBe(200);
  });
});

describe('the plans', () => {
  it('an experience over several weeks, changed and removed; two in one week are refused, beside the weeks they wait', async () => {
    const p = (await place(c.s1, { cadetId: ids['אביב'], category: 'broad_team', label: 'קה"ד צוותי', weekFrom: 1, weekTo: 4 })).body;
    expect(p).toMatchObject({ weekFrom: 1, weekTo: 4, span: 4, board: 'main' });
    const clash = await place(c.s1, { cadetId: ids['אביב'], weekFrom: 3, weekTo: 3 });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toContain('קה"ד צוותי');
    // beside the weeks, as long as it will be
    expect((await place(c.s1, { cadetId: ids['אביב'], label: 'מ"כ ניווטים', weekFrom: null, weekTo: null, span: 3 })).body).toMatchObject({ weekFrom: null, span: 3 });
    // another cadet's week is theirs
    expect((await place(c.s1, { cadetId: ids['גלעד'], weekFrom: 3, weekTo: 3 })).status).toBe(200);
    expect((await c.s1.patch(`/api/takpatz/placements/${p.id}`, { weekTo: 2 })).body).toMatchObject({ weekTo: 2, span: 2 });
    expect((await place(c.s1, { cadetId: ids['אביב'], weekFrom: 3, weekTo: 3 })).status).toBe(200);
    expect((await c.s1.patch(`/api/takpatz/placements/${p.id}`, { weekTo: 5 })).status).toBe(409);
    expect((await c.s1.del(`/api/takpatz/placements/${p.id}`)).status).toBe(200);
    // weeks out of the plan, or half of them, are refused
    expect((await place(c.s1, { cadetId: ids['דורית'], weekFrom: 0, weekTo: 9 })).status).toBe(400);
    expect((await place(c.s1, { cadetId: ids['דורית'], weekFrom: 2, weekTo: null })).status).toBe(400);
    expect((await place(c.s1, { cadetId: ids['דורית'], weekFrom: 4, weekTo: 2 })).status).toBe(400);
  });

  it('the second plan is its own: the same weeks hold other experiences, the cadets’ details are shared', async () => {
    const main = (await place(c.s1, { cadetId: ids['אביב'], weekFrom: 1, weekTo: 2 })).body;
    expect((await place(c.s1, { cadetId: ids['אביב'], board: 'alt', category: 'instruct_team', label: 'סק"ן כוכבים', weekFrom: 1, weekTo: 1 })).status).toBe(200);
    await c.s1.patch(`/api/takpatz/cadets/${ids['אביב']}`, { goals: ['לסמוך על אחרים', '', ''] });
    const v = (await c.s1.get(`/api/takpatz/teams/${team1}`)).body;
    expect(v.placements.filter((x: { board: string }) => x.board === 'main').map((x: { label: string }) => x.label)).toEqual(['ממ"ש שטח']);
    expect(v.placements.filter((x: { board: string }) => x.board === 'alt').map((x: { label: string }) => x.label)).toEqual(['סק"ן כוכבים']);
    // only the main plan's experiences are tracked
    expect(v.tracking.map((t: { label: string }) => t.label)).toEqual(['ממ"ש שטח']);
    // copying one into the other plan meets what is there
    expect((await c.s1.post(`/api/takpatz/placements/${main.id}/copy`, { to: 'alt' })).status).toBe(409);
    // the second plan as a copy of the main one
    expect((await c.s1.post(`/api/takpatz/teams/${team1}/copy-board`, { from: 'main', to: 'alt' })).body).toEqual({ copied: 1 });
    const after = (await c.s1.get(`/api/takpatz/teams/${team1}`)).body;
    expect(after.placements.filter((x: { board: string }) => x.board === 'alt').map((x: { label: string; weekTo: number }) => [x.label, x.weekTo])).toEqual([['ממ"ש שטח', 2]]);
    expect(after.history[0].text).toContain('תכנון נוסף הוחלף');
  });
});

describe('the tracking', () => {
  it("each experience of the main plan is a row; its stages are kept; the numbers follow", async () => {
    const p = (await place(c.s1, { cadetId: ids['אביב'], weekFrom: 2, weekTo: 2 })).body;
    await c.s1.put('/api/takpatz/stages', { placementId: p.id, stage: 'download', status: 'done', date: '2026-10-04' });
    const row = (await c.s1.put('/api/takpatz/stages', { placementId: p.id, stage: 'exec', status: 'done', note: 'בוצע בשטח' })).body;
    expect(row.stages.download).toEqual({ status: 'done', date: '2026-10-04', note: '' });
    expect(row.stages.exec).toMatchObject({ status: 'done', note: 'בוצע בשטח' });
    // one tracked on its own, beside the plan
    const own = (await c.s1.post('/api/takpatz/tracking', { cadetId: ids['גלעד'], label: 'ק. אקדמיה', week: 3 })).body.id;
    await c.s1.put('/api/takpatz/stages', { trackingId: own, stage: 'at', status: 'set' });
    let v = (await c.s1.get(`/api/takpatz/teams/${team1}`)).body;
    expect(v.tracking.map((t: { label: string; cadetName: string }) => [t.label, t.cadetName])).toEqual([
      ['ממ"ש שטח', 'אביב שקד'],
      ['ק. אקדמיה', 'גלעד רימון'],
    ]);
    expect(v.metrics).toMatchObject({ cadets: 3, planned: 1, executed: 1, feedbackToWrite: 1, feedbackToDeliver: 0, withoutExperience: 2 });
    await c.s1.put('/api/takpatz/stages', { placementId: p.id, stage: 'write', status: 'done' });
    v = (await c.s1.get(`/api/takpatz/teams/${team1}`)).body;
    expect(v.metrics).toMatchObject({ feedbackToWrite: 0, feedbackToDeliver: 1 });
    // the commander's view of the company has the same numbers
    expect((await c.cmd.get('/api/takpatz')).body.teams.find((t: { id: number }) => t.id === team1).metrics).toMatchObject({ executed: 1, feedbackToDeliver: 1 });
    // removing the experience keeps what was tracked, as a row of its own
    await c.s1.del(`/api/takpatz/placements/${p.id}`);
    v = (await c.s1.get(`/api/takpatz/teams/${team1}`)).body;
    expect(v.tracking.find((t: { label: string }) => t.label === 'ממ"ש שטח')).toMatchObject({ placementId: null, stages: { exec: { status: 'done' } } });
  });
});

// ---------------- the spreadsheet ----------------

/** the files of a zip as written here (stored, no compression) */
function readZip(zip: Uint8Array): Map<string, string> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out = new Map<string, string>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLen));
    out.set(name, new TextDecoder().decode(zip.subarray(at + 30 + nameLen, at + 30 + nameLen + size)));
    at += 30 + nameLen + size;
  }
  return out;
}

const binary = (res: { body: unknown }) => new Uint8Array(res.body as Buffer);
async function exportOf(agent: Agent, teamId: number) {
  const res = await agent.get(`/api/takpatz/teams/${teamId}/export`).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on('data', (d: Buffer) => chunks.push(d));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  return res;
}
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strings = (files: Map<string, string>) => [...files.get('xl/sharedStrings.xml')!.matchAll(/<t(?: xml:space="preserve")?>([^<]*)<\/t>/g)].map((m) => unescape(m[1]));
const cell = (xml: string, files: Map<string, string>, ref: string) => {
  const m = xml.match(new RegExp(`<c r="${ref}" s="(\\d+)"(?: t="s")?(?:/>|><v>([^<]*)</v></c>)`));
  if (!m) return null;
  const isText = new RegExp(`<c r="${ref}" s="\\d+" t="s">`).test(xml);
  return { s: Number(m[1]), v: m[2] === undefined ? null : isText ? strings(files)[Number(m[2])] : Number(m[2]) };
};

describe('the spreadsheet', () => {
  it('five sheets as the course file has them, the data in its cells, the merges from the weeks', async () => {
    await c.s1.patch(`/api/takpatz/cadets/${ids['אביב']}`, { goals: ['קבלת החלטות', 'לא לרצות', ''], third: 'middle', rank: 2 });
    await c.s1.patch(`/api/takpatz/cadets/${ids['גלעד']}`, { rank: 1, third: 'upper' });
    await place(c.s1, { cadetId: ids['אביב'], category: 'broad_company', label: 'סמ"פ', weekFrom: 1, weekTo: 4 });
    const single = (await place(c.s1, { cadetId: ids['אביב'], weekFrom: 6, weekTo: 6, label: 'ממ"ש' })).body;
    await place(c.s1, { cadetId: ids['גלעד'], label: 'מ"כ ניווטים', weekFrom: null, weekTo: null, span: 3 });
    await place(c.s1, { cadetId: ids['גלעד'], board: 'alt', category: 'instruct_team', label: 'סיור הר הרצל', weekFrom: 6, weekTo: 6 });
    await c.s1.put('/api/takpatz/stages', { placementId: single.id, stage: 'download', status: 'done' });
    const res = await exportOf(c.s1, team1);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(decodeURIComponent(res.headers['content-disposition'])).toContain('תקפ״צ - צוות אלון - ');
    const files = readZip(binary(res));
    const wb = files.get('xl/workbook.xml')!;
    expect([...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1])).toEqual([BOARD_SHEET_NAMES.main, 'Sheet8', 'מעקב התנסויות ומשובים', 'תכנון התנסויות צוותיות', 'מיפוי שלישים לאחר ODT']);
    const s1 = files.get('xl/worksheets/sheet1.xml')!;
    // right to left, the names and the head frozen, the third's column hidden, filters over the cadets
    expect(s1).toContain('<sheetView rightToLeft="1" workbookViewId="0"><pane xSplit="1.0" ySplit="1.0" topLeftCell="B2" activePane="bottomRight" state="frozen"/>');
    expect(s1).toContain('<col customWidth="1" hidden="1" min="2" max="2" width="12.57"/>');
    expect(s1).toContain('<autoFilter ref="$A$1:$P$4"/>');
    expect(cell(s1, files, 'H1')!.v).toBe('שבוע 0\nסף');
    expect(cell(s1, files, 'A2')).toEqual({ s: 4, v: 'אביב שקד' });
    expect(cell(s1, files, 'B2')).toEqual({ s: 5, v: 'אמצעי' });
    expect(cell(s1, files, 'C2')).toEqual({ s: 4, v: 'קבלת החלטות' });
    // four weeks of a broad company experience: one green cell from week 1 (I) to week 4 (L)
    expect(cell(s1, files, 'I2')).toEqual({ s: 12, v: 'סמ"פ' });
    expect(cell(s1, files, 'J2')!.s).toBe(8);
    expect(cell(s1, files, 'L2')!.s).toBe(10);
    expect(s1).toContain('<mergeCell ref="I2:L2"/>');
    // one week of a command experience: blue, alone; the empty weeks gray
    expect(cell(s1, files, 'N2')).toEqual({ s: 19, v: 'ממ"ש' });
    expect(cell(s1, files, 'H2')!.s).toBe(9);
    // beside the weeks from R, three columns long
    expect(cell(s1, files, 'R3')).toEqual({ s: 50, v: 'מ"כ ניווטים' });
    expect(s1).toContain('<mergeCell ref="R3:T3"/>');
    // the legends under the three cadets (row 4): from row 8, the optional ones hidden below
    expect(cell(s1, files, 'C8')!.v).toBe('רוחב פלוגתי');
    expect(s1).toContain('<mergeCell ref="C8:D8"/>');
    expect(cell(s1, files, 'C11')!.v).toBe('פיקודי - צוות');
    expect(s1).toMatch(/<row r="21" ht="14.25" hidden="1" customHeight="1">/);
    // the second plan: its own experiences, the same details
    const s2 = files.get('xl/worksheets/sheet2.xml')!;
    expect(cell(s2, files, 'I2')!.s).toBe(9);
    expect(cell(s2, files, 'N3')).toEqual({ s: 75, v: 'סיור הר הרצל' });
    expect(cell(s2, files, 'C2')!.v).toBe('קבלת החלטות');
    // the tracking: a row for each experience of the main plan, a table over them, the list to choose from
    const s3 = files.get('xl/worksheets/sheet3.xml')!;
    expect(cell(s3, files, 'C1')!.v).toBe('הורדת התנסות');
    const tracked = [2, 3, 4].map((r) => [cell(s3, files, `A${r}`)!.v, cell(s3, files, `B${r}`)!.v]);
    expect(tracked).toEqual([
      ['סמ"פ', 'אביב שקד'],
      ['ממ"ש', 'אביב שקד'],
      ['מ"כ ניווטים', 'גלעד רימון'],
    ]);
    expect(cell(s3, files, 'C3')!.v).toBe('בוצע');
    expect(s3).toContain('sqref="C2:G4"><formula1>&quot;בוצע,נקבע,לא נקבע&quot;</formula1>');
    expect(files.get('xl/tables/table1.xml')).toContain('ref="A1:G4"');
    // the planning by halves: the catalog's blocks, and who has each
    const s4 = files.get('xl/worksheets/sheet4.xml')!;
    expect(cell(s4, files, 'A1')!.v).toBe("חציון א'");
    expect(s4).toContain('<mergeCell ref="A1:E1"/>');
    expect(cell(s4, files, 'G1')!.v).toBe("חציון ב'");
    expect(cell(s4, files, 'A9')!.v).toBe('ממ"ש היסוד');
    expect(cell(s4, files, 'G11')!.v).toBe('הדרכתי - צוותי');
    expect(cell(s4, files, 'L3')!.v).toBe('סמפ');
    expect(s4).toContain('<col customWidth="1" min="8" max="8" width="18.43"/>');
    // the thirds by rank, numbered up to the team's size, the list to choose from
    const s5 = files.get('xl/worksheets/sheet5.xml')!;
    expect(cell(s5, files, 'C1')!.v).toBe('מספור (1-3)');
    expect([cell(s5, files, 'A2')!.v, cell(s5, files, 'B2')!.v, cell(s5, files, 'C2')!.v]).toEqual(['גלעד רימון', 'עליון', 1]);
    expect(s5).toContain('sqref="B2:B4"><formula1>&quot;עליון,אמצעי,תחתון&quot;</formula1>');
    expect(s5).toContain('<autoFilter ref="$A$1:$C$4">');
    // every text is the team's or the file's own headings - nothing else
    expect(strings(files).some((s) => /הדר תמר|ורד זית/.test(s))).toBe(false);
  });

  it('a team larger than the example: a row for each cadet, the legends and the ranges after them', async () => {
    for (let i = 0; i < 13; i++) await c.cmd.post('/api/cadets', { firstName: `צוער${i + 1}`, lastName: 'בדיקה', personalNumber: '', teamId: team1 });
    const files = readZip(binary(await exportOf(c.s1, team1)));
    const s1 = files.get('xl/worksheets/sheet1.xml')!;
    // 16 cadets in rows 2-17: the legends from row 21
    expect(s1).toContain('<autoFilter ref="$A$1:$P$17"/>');
    expect(cell(s1, files, 'C21')!.v).toBe('רוחב פלוגתי');
    expect(cell(files.get('xl/worksheets/sheet5.xml')!, files, 'C1')!.v).toBe('מספור (1-16)');
    expect(files.get('xl/workbook.xml')).toContain("'מיפוי שלישים לאחר ODT'!$A$1:$C$17");
  });

  it('two experiences in one week stop the export until one moves', async () => {
    const a = (await place(c.s1, { cadetId: ids['אביב'], weekFrom: 1, weekTo: 2 })).body;
    // as if kept before the check: straight into the table
    db().run("INSERT INTO takpatz_placements(cadet_id, board, category, label, week_from, week_to, span, created_at, updated_at) VALUES (?, 'main', 'broad_team', 'קחו\"ם', 2, 3, 2, 'x', 'x')", ids['אביב']);
    const res = await c.s1.get(`/api/takpatz/teams/${team1}/export`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('אביב שקד');
    await c.s1.patch(`/api/takpatz/placements/${a.id}`, { weekTo: 1 });
    expect((await exportOf(c.s1, team1)).status).toBe(200);
  });
});

// ---------------- Google Drive ----------------

describe('saving to Google Drive', () => {
  it('is offered only once set up on the server', async () => {
    expect((await c.s1.get(`/api/takpatz/teams/${team1}`)).body.driveAvailable).toBe(false);
    expect((await c.s1.post(`/api/takpatz/teams/${team1}/drive`)).status).toBe(503);
  });

  it("goes by Google's sign-in, uploads the file as it is into the app's folder, and keeps no token", async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    const calls: { url: string; init?: RequestInit }[] = [];
    setDriveFetch(async (url, init) => {
      calls.push({ url, init });
      if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'ya29.one-time' });
      if (url.includes('/drive/v3/files?q=') || url.includes('drive/v3/files?q')) return Response.json({ files: [] });
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?fields=id')) return Response.json({ id: 'folder1' });
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) return Response.json({ id: 'file1', webViewLink: 'https://drive.google.com/file/d/file1/view' });
      return new Response('', { status: 200 });
    });
    const start = (await c.s1.post(`/api/takpatz/teams/${team1}/drive`)).body.url as string;
    const u = new URL(start);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const state = u.searchParams.get('state')!;
    // someone else coming back with it: refused, and the save is used up
    const other = await (await login(c.app, 's2')).get(`/api/google/drive/callback?state=${state}&code=abc`);
    expect(other.headers.location).toBe(`/takpatz/${team1}?drive=denied`);
    expect((await c.s1.get(`/api/google/drive/callback?state=${state}&code=abc`)).headers.location).toBe('/takpatz?drive=expired');
    // the one who asked
    const again = new URL((await c.s1.post(`/api/takpatz/teams/${team1}/drive`)).body.url as string).searchParams.get('state')!;
    calls.length = 0;
    const done = await c.s1.get(`/api/google/drive/callback?state=${again}&code=abc`);
    expect(done.status).toBe(303);
    expect(done.headers.location).toBe(`/takpatz/${team1}?drive=ok&link=${encodeURIComponent('https://drive.google.com/file/d/file1/view')}`);
    const token = calls.find((x) => x.url.startsWith('https://oauth2.googleapis.com/token'))!;
    expect(String(token.init!.body)).toContain('code_verifier=');
    expect(String(token.init!.body)).toContain('code=abc');
    const upload = calls.find((x) => x.url.startsWith('https://www.googleapis.com/upload/'))!;
    const body = (upload.init!.body as Buffer).toString('utf8');
    expect(body).toContain('"mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"');
    expect(body).toContain('"parents":["folder1"]');
    expect(body).toContain('תקפ״צ - צוות אלון');
    // the token is given back, and nothing of it is kept
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((x) => x.url.startsWith('https://oauth2.googleapis.com/revoke?token=ya29.one-time'))).toBe(true);
    expect(db().get<{ n: number }>('SELECT count(*) AS n FROM google_drive_requests')!.n).toBe(0);
    // Google saying no: back to the takpatz, nothing saved
    const third = new URL((await c.s1.post(`/api/takpatz/teams/${team1}/drive`)).body.url as string).searchParams.get('state')!;
    expect((await c.s1.get(`/api/google/drive/callback?state=${third}&error=access_denied`)).headers.location).toBe(`/takpatz/${team1}?drive=cancelled`);
  });
});
