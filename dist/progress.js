// Store question IDs rather than a second copy of the question bank.
export function writeProgress(storage, key, active, previousSubjects) {
  const states = new Map(previousSubjects);
  states.set(active.subjectId, active);
  const sessions = {};
  for (const [id, state] of states) {
    const s = state.session;
    if (!s) continue;
    sessions[id] = {
      chapterIndex:state.chapterIndex, sectionName:state.sectionName,
      mode:s.mode, ids:s.items.map(q => q.id), index:s.index,
      answers:s.answers, orders:s.orders,
      finished:s.finished, showResult:s.showResult, seconds:s.seconds
    };
  }
  storage.setItem(key, JSON.stringify({version:1, subjectId:active.subjectId,
    selectionOpen:active.selectionOpen, fontSize:active.fontSize, sessions}));
}

export function readProgress(storage, key, subjects) {
  let saved;
  try { saved = JSON.parse(storage.getItem(key) || 'null'); }
  catch { return null; }
  if (!saved || saved.version !== 1 || !subjects[saved.subjectId] ||
      !saved.sessions || typeof saved.sessions !== 'object') return null;
  const states = new Map();
  for (const [id, value] of Object.entries(saved.sessions)) {
    const subject = subjects[id];
    if (!subject || !value || !['learn','mock','wrong'].includes(value.mode) ||
        !Number.isInteger(value.chapterIndex) || value.chapterIndex < 0 ||
        value.chapterIndex >= subject.chapters.length || !Array.isArray(value.ids) ||
        new Set(value.ids).size !== value.ids.length) continue;
    const byId = new Map(subject.questions.map(q => [q.id,q]));
    const items = value.ids.map(id => byId.get(id));
    // A removed question invalidates this session, without touching statistics.
    if (items.some(q => !q) || (!items.length && value.mode !== 'wrong')) continue;
    const sections = [...new Set(subject.questions.filter(q => q.chapterIndex === value.chapterIndex)
      .map(q => q.studySection || q.source?.section).filter(Boolean))];
    const sectionName = value.sectionName === '__all__' || sections.includes(value.sectionName)
      ? value.sectionName : sections[0] || '__all__';
    if (value.mode === 'learn' && items.some(q => q.chapterIndex !== value.chapterIndex ||
        (sectionName !== '__all__' && (q.studySection || q.source?.section) !== sectionName))) continue;
    const answers = {}, orders = {};
    const finished = value.mode === 'mock' && value.finished === true;
    for (const q of items) {
      const order = value.orders?.[q.id];
      if (q.options) {
        const natural = q.options.map((_,i) => i);
        orders[q.id] = Array.isArray(order) && order.length === natural.length &&
          new Set(order).size === natural.length && order.every(i => Number.isInteger(i) && natural.includes(i))
          ? order.slice() : natural;
      }
      const a = value.answers?.[q.id];
      if (!a || typeof a !== 'object') continue;
      const choices = Array.isArray(a.choices) ? [...new Set(a.choices.filter(i =>
        Number.isInteger(i) && i >= 0 && i < (q.options?.length || 0)))] : [];
      const submitted = a.submitted === true;
      answers[q.id] = {choices:q.type === 'single' ? choices.slice(0,1) : choices,
        text:typeof a.text === 'string' ? a.text : '', submitted,
        judged:typeof a.judged === 'boolean' ? a.judged : null,
        recorded:a.recorded === true && (submitted || finished)};
    }
    const session = {mode:value.mode, items,
      index:Number.isInteger(value.index) ? Math.max(0,Math.min(value.index,items.length-1)) : 0,
      answers, orders, finished, showResult:finished && value.showResult === true,
      seconds:Number.isFinite(value.seconds) ? Math.max(0,Math.min(2700,Math.floor(value.seconds))) : 2700};
    states.set(id, {session, chapterIndex:value.chapterIndex, sectionName});
  }
  if (!states.has(saved.subjectId)) return null;
  return {subjectId:saved.subjectId, selectionOpen:saved.selectionOpen === true,
    fontSize:Number.isFinite(saved.fontSize) ? Math.max(.85,Math.min(1.4,saved.fontSize)) : 1, states};
}
