// 前端渲染：纯原生 JS，数据全部来自 /api/state，点击结论打开溯源抽屉。
let state = null;

const STATUS_LABEL = {
  positive: '正观察',
  'qualified-negative': '合格缺席（条件下未记录）',
  insufficient: '证据不足',
  'no-valid-coverage': '无有效覆盖',
  'mixed-conflict': '同范围冲突',
};

const KIND_LABEL = {
  positive: '正观察',
  negative: '未观察',
  inference: '推测',
  citation: '征引',
  correction: '纠正',
  coverage: '未覆盖',
  gearNote: '器材待核说明',
};

const ISSUE_LABEL = {
  rainNoise: '雨后噪声大，本场静听不计有效',
  gearUnverified: '网具规格待核，方法完整性不成立',
  methodNotApplied: '未实际采用登记方法',
  outsideWindow: '时段不在方法观察窗口内',
  outOfSeasonMonth: '月份不在方法适用季节',
  targetNotApplicable: '方法卡不适用该对象',
};

async function main() {
  state = await fetch('/api/state').then(r => r.json());
  renderBriefing();
  renderLedger();
  renderHearing();
  renderGaps(state.plan);
  renderPending();
  renderWarnings();

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
  document.getElementById('drawer-close').addEventListener('click', () => {
    document.getElementById('drawer').classList.add('hidden');
  });
}

function badge(text, cls) {
  return `<span class="badge ${cls ?? 'neutral'}">${text}</span>`;
}

function claimIdOf(entry) {
  return `claim|${entry.key}`;
}

function renderBriefing() {
  const panel = document.getElementById('tab-briefing');
  const { briefing } = state;
  panel.innerHTML = `
    <h2 class="section">可面向公众的局部结果（${briefing.publishable.length}）</h2>
    <div class="cards">
      ${briefing.publishable.map(claim => `
        <div class="card" data-claim="${claim.id}">
          <div class="title">${badge(STATUS_LABEL[claim.status] ?? claim.status, claim.status)}${claim.plotLabel} · ${claim.target} · ${claim.season}</div>
          <div class="limit">${claim.limitation}</div>
          <div class="meta">证据陈述 ${claim.statementIds.length} 条 · 点击查看成立依据</div>
        </div>`).join('')}
    </div>

    <h2 class="section">只能作为待核假设（${briefing.hypotheses.length}）</h2>
    <div class="cards">
      ${briefing.hypotheses.map(claim => `
        <div class="card" data-claim="${claim.id}">
          <div class="title">${badge(STATUS_LABEL[claim.status] ?? claim.status, claim.status)}${claim.plotLabel} · ${claim.target} · ${claim.season}</div>
          <div class="limit">${claim.limitation}</div>
        </div>`).join('')}
    </div>

    <h2 class="section">有争议的整区结论（保留但不发布，${briefing.withheld.length}）</h2>
    <div class="cards">
      ${briefing.withheld.map(item => `
        <div class="card" data-claim="${item.id}">
          <div class="title">${badge('暂不发布', 'withheld')}${item.plotLabel} · ${item.target}</div>
          <div class="quote">${item.sentence}</div>
          <div class="meta">${item.reasons.join('；')}</div>
        </div>`).join('')}
    </div>

    <h2 class="section">已发布说法的更正说明（${briefing.corrections.length}）</h2>
    ${briefing.corrections.map(c => `
      <div class="correction-box">
        <h3>${c.id} · ${c.changeLabel}</h3>
        <div><b>更正后表述：</b>${c.newSentence}</div>
        <div class="meta" style="margin-top:6px">引用手记：${c.citations.join('、')} ｜ ${c.reason}</div>
      </div>`).join('')}
    <div class="coverage-note">${briefing.coverageNote}</div>
  `;
  panel.querySelectorAll('[data-claim]').forEach(el => {
    el.addEventListener('click', () => openClaim(el.dataset.claim));
  });
}

function renderLedger() {
  const panel = document.getElementById('tab-ledger');
  panel.innerHTML = `
    <table>
      <thead><tr>
        <th>物种 × 单元 × 季节</th><th>状态</th><th>完整有效/要求</th><th>独立调查</th>
        <th>正观察</th><th>待核/转引/失效</th>
      </tr></thead>
      <tbody>
        ${state.entries.map(e => `
          <tr class="clickable" data-claim="${claimIdOf(e)}">
            <td><b>${e.target}</b> @ ${plotLabel(e.plotId)}<br><span class="kv">${e.season} · ${e.methodId}</span></td>
            <td>${badge(STATUS_LABEL[e.status], e.status)}${e.qualifiedNegative ? badge('可判条件下未记录', 'publishable') : ''}</td>
            <td>${e.completeCount} / ${e.completedMin ?? '—'}</td>
            <td>${e.independentSurveyIds.join('、') || '—'}</td>
            <td>${e.positives.length}</td>
            <td>
              ${e.pendingPlaceStatements.length ? badge(`地点待核 ${e.pendingPlaceStatements.length}`, 'unresolvedPlace') : ''}
              ${e.citationStatements.length ? badge(`转引 ${e.citationStatements.length}`, 'mixed-conflict') : ''}
              ${e.invalidStatements.length ? badge(`失效 ${e.invalidStatements.length}`, 'invalid') : ''}
              ${e.coverageStatements.length ? badge(`未覆盖 ${e.coverageStatements.length}`, 'coverage') : ''}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    <p class="note">转引与重述回到同一独立调查，不增加“独立调查”列的数量。点击行查看逐条陈述溯源。</p>
  `;
  panel.querySelectorAll('[data-claim]').forEach(el => {
    el.addEventListener('click', () => openClaim(el.dataset.claim));
  });
}

function renderHearing() {
  const panel = document.getElementById('tab-hearing');
  panel.innerHTML = state.decisions.map(d => `
    <div class="card" style="margin-bottom:12px;cursor:default">
      <div class="title">
        ${badge(d.disposition, d.disposition === '可面向公众' ? 'publishable' : d.disposition === '暂不发布' ? 'withheld' : 'hypothesis')}
        ${d.hearingStatus} · ${d.scopeLabel} · ${d.target ?? '对象待核'}
        ${d.publishedAt ? `<span class="kv">（${d.publishedAt} 已对外发布）</span>` : '<span class="kv">（未发布）</span>'}
      </div>
      <div class="quote">${d.originalSentence}</div>
      ${d.limitations.length ? `<ul class="clean">${d.limitations.map(l => `<li class="note">${l}</li>`).join('')}</ul>` : ''}
      <div class="meta">引用手记：${d.references.join('、')} ｜ 单元状态：
        ${d.unitStatus.map(u => `${plotLabel(u.plotId)}=${STATUS_LABEL[u.status] ?? u.status}`).join('；')}
      </div>
      ${d.correction ? `
        <div class="correction-box">
          <h3>待签发更正：${d.correction.changeLabel}</h3>
          <div>${d.correction.newSentence}</div>
          <div class="meta" style="margin-top:6px">引用 ${d.correction.citations.join('、')} ｜ ${d.correction.reason}</div>
        </div>` : ''}
    </div>`).join('');
}

function renderGaps(plan) {
  const panel = document.getElementById('tab-gaps');
  panel.innerHTML = `
    <h2 class="section">已派出在途（不得自动拆散或改期）</h2>
    <table><thead><tr><th>缺口</th><th>预订</th><th>队伍</th><th>约定</th></tr></thead><tbody>
      ${plan.scheduled.map(item => `
        <tr><td>${gapText(item.gapId)}</td><td>${item.bookingId}</td><td>${item.team}</td><td class="note">${item.note}</td></tr>
      `).join('')}
    </tbody></table>

    <h2 class="section">建议占用的可用窗口（同队窗口按对象数占容量、可合并出队）</h2>
    <table><thead><tr><th>缺口</th><th>预订</th><th>队伍</th><th>窗口</th></tr></thead><tbody>
      ${plan.open.map(item => `
        <tr><td>${gapText(item.gapId)}</td><td>${item.bookingId ?? '—'}</td><td>${item.team ?? '—'}</td><td class="kv">${item.window ?? item.mode}</td></tr>
      `).join('')}
    </tbody></table>

    <h2 class="section">历史季节遗留（现有窗口不可代替本期覆盖，不占当季名额）</h2>
    ${(plan.historical ?? []).map(h => `
      <div class="card" style="margin-bottom:8px;cursor:default">
        <div class="title">${badge('历史缺口', 'neutral')}${h.target} @ ${plotLabel(h.plotId)} · ${h.season} · ${h.methodId}</div>
        <div class="meta">${h.note}</div>
      </div>`).join('')}

    <h2 class="section">过季/无窗口冲突：需专家选择优先处置</h2>
    ${plan.conflicts.map(c => `
      <div class="card" style="margin-bottom:12px;cursor:default">
        <div class="title">${badge(c.kind === 'outOfSeason' ? '适用季节已过' : c.kind === 'capacityFull' ? '容量已满' : '无可用窗口', c.kind)}
          ${c.target} @ ${plotLabel(c.plotId)} · ${c.season}</div>
        <div class="meta">${c.reasonLabel}：${c.detail}</div>
        <div style="margin-top:6px">
          ${c.options.map(o => `<div class="kv">预订 ${o.bookingId}：${o.eligible ? '<span class="ok-tag">可达</span>' : `<span class="invalid-tag">${o.blockers.join('；')}</span>`}</div>`).join('')}
        </div>
        <div class="coverage-note" style="margin-bottom:6px">
          若搁置：${c.heldConsequences.map(h => `${h.claimId}（${STATUS_LABEL[h.currentStatus]}）${h.blockedUpgrade}`).join('；') || '暂无关联说法'}
        </div>
        <button class="action" data-priority="${c.gapId}" data-choice="优先">优先处置此缺口</button>
        <button class="action danger" data-priority="${c.gapId}" data-choice="搁置">接受搁置并冻结相关说法升级</button>
      </div>`).join('')}

    <h2 class="section">合并出队与取消约定</h2>
    <ul class="clean">${plan.mergeRules.map(r => `<li class="note">${r}</li>`).join('')}</ul>
    <h2 class="section">专家可整单取消仍有缺口的已派出预约</h2>
    ${plan.bookings.filter(b => b.state === '已派出').map(b => `
      <div class="card" style="cursor:default;margin-bottom:8px">
        <b>${b.id} · ${b.team}</b> <span class="kv">${b.window} 容量 ${b.usedCapacity}/${b.capacity} 对象 ${b.targets.join('、')}</span>
        <div><button class="action danger" data-cancel="${b.id}">专家整单取消（缺口保留）</button></div>
      </div>`).join('')}
  `;

  panel.querySelectorAll('[data-priority]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'prioritize', gapId: btn.dataset.priority, choice: btn.dataset.choice }),
      }).then(r => r.json());
      if (res.ok) renderGaps(res.plan);
    });
  });
  panel.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'cancelBooking', bookingId: btn.dataset.cancel }),
      }).then(r => r.json());
      if (res.ok) renderGaps(res.plan);
      else alert(res.error);
    });
  });
}

function renderPending() {
  const panel = document.getElementById('tab-pending');
  panel.innerHTML = `
    <p class="note">区划名册中的历史称呼可能重叠；无法确定覆盖哪一部分时给专家待核选项，不把整区画成阴性。</p>
    <table><thead><tr><th>陈述</th><th>对象</th><th>候选单元</th><th>操作</th></tr></thead><tbody>
      ${state.pendingPlace.map(p => `
        <tr>
          <td class="kv">${p.statementId}（来自 ${p.noteId}）</td>
          <td>${p.target}</td>
          <td>${p.candidates.map(c => badge(`${c} ${plotLabel(c)}`, 'unresolvedPlace')).join('')}</td>
          <td>${p.candidates.map(c => `<button class="action" data-resolve='${JSON.stringify({ statementId: p.statementId, plotId: c })}'>核定为 ${plotLabel(c)}</button>`).join('')}</td>
        </tr>`).join('')}
    </tbody></table>
    <div id="resolve-result" class="note"></div>
  `;
  panel.querySelectorAll('[data-resolve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const payload = { type: 'resolvePlace', ...JSON.parse(btn.dataset.resolve) };
      const res = await fetch('/api/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json());
      if (res.ok) document.getElementById('resolve-result').textContent = `已登记待核决定：${payload.statementId} -> ${payload.plotId}（原始资料未被改写）`;
    });
  });
}

function renderWarnings() {
  const panel = document.getElementById('tab-warnings');
  panel.innerHTML = state.parseWarnings.length === 0
    ? '<p class="note">全部原句都已归入证据陈述或程序性说明，没有未解析片段。</p>'
    : `<table><thead><tr><th>手记</th><th>原句片段</th><th>原因</th></tr></thead><tbody>
        ${state.parseWarnings.map(w => `<tr><td>${w.noteId}</td><td>${w.clause}</td><td class="invalid-tag">${w.reason}</td></tr>`).join('')}
      </tbody></table>`;
}

async function openClaim(id) {
  const detail = await fetch(`/api/claim?id=${encodeURIComponent(id)}`).then(r => r.json());
  const drawer = document.getElementById('drawer');
  document.getElementById('drawer-title').textContent = detail.kind === 'withheld-hearing'
    ? `整区结论 · ${detail.scopeLabel}`
    : `溯源 · ${detail.target} @ ${plotLabel(detail.plotId)} · ${detail.season}`;
  const body = document.getElementById('drawer-body');

  if (detail.kind === 'withheld-hearing') {
    body.innerHTML = `
      <div class="quote">${detail.originalSentence}</div>
      <p class="invalid-tag">${detail.limitations.join('；')}</p>
      <h3>各单元证据状态</h3>
      ${detail.unitStatus.map(u => `<div>${badge(STATUS_LABEL[u.status] ?? u.status, u.status)} ${plotLabel(u.plotId)}</div>`).join('')}
      <p class="note">局部可引用结果仍保留在简报中，没有随整区结论一起删除。</p>`;
    drawer.classList.remove('hidden');
    return;
  }

  body.innerHTML = `
    <div>${badge(STATUS_LABEL[detail.status], detail.status)}
      ${detail.qualifiedNegative ? badge('合格缺席', 'publishable') : ''}</div>
    <p class="note">${detail.limitation}</p>
    <p class="kv">完整有效观察 <b>${detail.completeCount}/${detail.completedMin ?? '?'}</b> ｜
      独立调查：<b>${detail.independentSurveyIds.join('、') || '无'}</b>（重述/转引不重复计数）</p>
    ${detail.correction ? `<div class="correction-box"><h3>${detail.correction.changeLabel}</h3>
      <div>${detail.correction.newSentence}</div>
      <div class="meta" style="margin-top:6px">引用 ${detail.correction.citations.join('、')}</div></div>` : ''}
    <h3>逐条陈述（为什么成立 / 被什么限定 / 被谁推翻）</h3>
    ${detail.trace.map(traceRow).join('')}
  `;
  drawer.classList.remove('hidden');
}

function traceRow(s) {
  const placeText = s.place.uncertain
    ? badge(`地点待核：${s.place.candidates.map(plotLabel).join('/')}`, 'unresolvedPlace')
    : badge(`${s.place.plotIds.map(plotLabel).join('/')}（${s.place.term ?? '明确'}）`, 'publishable');
  return `
    <div class="trace-item">
      <div class="row">
        ${badge(KIND_LABEL[s.kind] ?? s.kind, s.kind === 'positive' || s.kind === 'correction' ? 'publishable' : s.kind === 'citation' ? 'mixed-conflict' : 'neutral')}
        ${placeText}
        ${s.supersededBy ? badge(`已被 ${s.supersededBy} 勘误取代`, 'withheld') : ''}
        ${s.corrects ? badge(`纠正自 ${s.corrects}`, 'hypothesis') : ''}
      </div>
      <div class="quote">${s.text}</div>
      <div class="kv">
        ${s.independentSurveyId} · ${s.team} · ${s.date} ${s.slot} · ${s.season} · ${s.methodLabel} ·
        完整场次：${s.complete ? '是' : '否'} ·
        ${s.validity.valid ? '<span class="ok-tag">方法有效</span>' : s.validity.issues.map(i => `<span class="invalid-tag">${ISSUE_LABEL[i] ?? i}</span>`).join(' ')}
      </div>
      ${s.cites.length ? `<div class="cite-tag">征引 ${s.cites.join('、')}（不增加独立调查）${s.citedScopeMismatch ? '；<span class="invalid-tag">引用中的“这里”与本卡地点范围不一致，需分别看待</span>' : ''}</div>` : ''}
      <div class="meta" style="margin-top:4px">来源陈述 ${s.statementId} ｜ 手记 ${s.noteId}</div>
    </div>`;
}

function plotLabel(id) {
  const plot = state.plots.find(p => p.id === id);
  return plot ? `${plot.label}(${id})` : id;
}

function gapText(gapId) {
  const gap = state.gaps.find(g => g.id === gapId);
  return gap ? `${gap.target} @ ${plotLabel(gap.plotId)} · ${gap.season} · ${gap.methodId}` : gapId;
}

main().catch(error => {
  document.body.insertAdjacentHTML('afterbegin', `<div class="coverage-note">加载失败：${error.message}</div>`);
});
