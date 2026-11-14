let imdfData = null;
let currentPersona = 'mak'; // 'mak' (막해일) 또는 'gil' (길라임)
let currentRouteState = {
  nodeId: 'opn-sam-01',
  alertLevel: 'safe_guide',
  rerouteRequired: false
};

// 초기화: IMDF 샘플 JSON 로드
async function initApp() {
  try {
    const response = await fetch('imdf-sample.json');
    imdfData = await response.json();
    updateHUD('opn-sam-01');
    appendMessage('ai', '안녕하세요! 코엑스-파르나스 실내 길라잡이 AI입니다. 현재 위치나 보이는 간판을 말씀해 주시면 AMD 행사장(웨스틴 서울 파르나스 하모니 볼룸)까지 안내해 드립니다.');
  } catch (error) {
    console.error('IMDF 데이터 로드 실패:', error);
    appendMessage('ai', '로컬 파일 보안 정책으로 인해 JSON을 불러오지 못했습니다. Live Server 또는 웹 호스팅(Vercel/Netlify) 환경에서 실행해 주세요.');
  }
}

// 페르소나 전환 (막해일 <-> 길라임)
function setPersona(persona) {
  currentPersona = persona;
  document.getElementById('btn-mak').classList.toggle('active', persona === 'mak');
  document.getElementById('btn-gil').classList.toggle('active', persona === 'gil');

  const msg = persona === 'mak'
    ? '🔄 [막해일 모드] 길치 보호 및 이탈 실시간 재탐색 엔진이 활성화되었습니다.'
    : '⚡ [길라임 모드] 최단 무결점 주파 경로(11분 직통) 모드로 전환되었습니다.';
  appendMessage('ai', msg);
}

// 자연어 입력 의도 및 IMDF 노드 추론
const LOCATION_PATTERNS = [
  {
    id: 'opn-sam-03',
    keywords: ['파르나스 타워', '파르나스몰', '타워', '남측 파르나스', '파르나스 타워인데', '오진입']
  },
  {
    id: 'opn-central-starfield',
    keywords: ['별마당', '별마당 도서관', '도서관', '중앙광장', '11시', '보이드서가', '서가']
  },
  {
    id: 'unt-aquarium-entrance',
    keywords: ['아쿠아', '아쿠아리움', '수족관', '봉은사', '봉은사역', '아셈플라자']
  },
  {
    id: 'opn-westin-lobby',
    keywords: ['하모니 볼룸', '웨스틴', '웨스틴 서울 파르나스', '로비', '연회장', '행사장', '호텔']
  },
  {
    id: 'opn-sam-01',
    keywords: ['삼성역', '밀레니엄', '코엑스몰', '코엑스', '광장', '입구']
  }
];

function normalizeQuery(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\\'\"`~!@#$%^&*()=+\[\]{};:,.<>/?\|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferNodeFromText(text) {
  const normalizedText = normalizeQuery(text);

  for (const pattern of LOCATION_PATTERNS) {
    const matched = pattern.keywords.some((keyword) => {
      const normalizedKeyword = normalizeQuery(keyword);
      return normalizedText.includes(normalizedKeyword);
    });

    if (matched) {
      return pattern.id;
    }
  }

  return 'opn-sam-01';
}

function getRouteGraph() {
  if (!imdfData || !imdfData.route_graph) {
    return {
      'opn-sam-01': ['opn-central-starfield', 'opn-sam-03'],
      'opn-sam-03': ['opn-sam-01'],
      'opn-central-starfield': ['opn-sam-01', 'unt-aquarium-entrance'],
      'unt-aquarium-entrance': ['opn-central-starfield', 'opn-westin-lobby'],
      'opn-westin-lobby': ['unt-aquarium-entrance']
    };
  }

  return imdfData.route_graph;
}

function findShortestPath(startNodeId, targetNodeId) {
  const graph = getRouteGraph();
  const queue = [[startNodeId]];
  const visited = new Set([startNodeId]);

  while (queue.length > 0) {
    const path = queue.shift();
    const currentNode = path[path.length - 1];

    if (currentNode === targetNodeId) {
      return path;
    }

    const neighbors = graph[currentNode] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return [startNodeId];
}

function detectRouteDeviation(nodeId, text) {
  if (!imdfData || !imdfData.nodes[nodeId]) {
    return {
      nodeId,
      alertLevel: 'safe_guide',
      rerouteRequired: false,
      reason: 'node_unknown'
    };
  }

  const normalizedText = normalizeQuery(text);
  const isOffRouteTrigger =
    normalizedText.includes('파르나스 타워') ||
    normalizedText.includes('파르나스몰') ||
    normalizedText.includes('타워인데') ||
    normalizedText.includes('오진입') ||
    normalizedText.includes('잘못') ||
    normalizedText.includes('길을 잃');

  const isFinalApproach =
    normalizedText.includes('로비') ||
    normalizedText.includes('호텔') ||
    normalizedText.includes('웨스틴') ||
    normalizedText.includes('도착') ||
    normalizedText.includes('행사장');

  if (nodeId === 'opn-sam-03' || isOffRouteTrigger) {
    return {
      nodeId: 'opn-sam-03',
      alertLevel: 'off_route_warning',
      rerouteRequired: true,
      reason: 'off_route_detected'
    };
  }

  if (nodeId === 'opn-westin-lobby' || isFinalApproach) {
    return {
      nodeId: 'opn-westin-lobby',
      alertLevel: 'arrived_building',
      rerouteRequired: false,
      reason: 'destination_reached'
    };
  }

  return {
    nodeId,
    alertLevel: imdfData.nodes[nodeId].alert_level || 'safe_guide',
    rerouteRequired: false,
    reason: 'normal_progress'
  };
}

// 상단 3D HUD 및 하단 JSON 인스펙터 업데이트
function updateHUD(nodeId) {
  if (!imdfData || !imdfData.nodes[nodeId]) return;
  const node = imdfData.nodes[nodeId];
  const level = imdfData.levels.find(l => l.id === node.level_id);
  const destinationId = imdfData.destination_id || 'opn-westin-lobby';
  const routePath = findShortestPath(nodeId, destinationId);
  const nextNode = routePath.length > 1 ? routePath[1] : routePath[0];
  const nextNodeInfo = imdfData.nodes[nextNode] || node;

  const routeState = detectRouteDeviation(nodeId, currentRouteState && currentRouteState.lastUserText ? currentRouteState.lastUserText : '');
  const alertLevel = routeState.alertLevel || node.alert_level;

  // 패널 스타일 변경
  const hudPanel = document.getElementById('hud-panel');
  hudPanel.className = `hud-panel ${alertLevel}`;

  // 텍스트 및 화살표 각도 갱신
  document.getElementById('hud-level').textContent = `${level.short_name} · ${level.name}`;
  document.getElementById('four-word-address').textContent = node.four_word;
  document.getElementById('current-node-name').textContent = node.name;
  document.getElementById('trap-warning').textContent = `⚠️ ${node.trap_warning}`;
  document.getElementById('arrow-indicator').style.transform = `rotate(${node.yaw_deg}deg)`;
  document.getElementById('yaw-text').textContent = node.yaw_deg === 180 ? '180° 유턴' : `Yaw ${node.yaw_deg}°`;

  const statusMap = {
    'safe_guide': '정상 경로 안내 중',
    'off_route_warning': '🚨 경로 이탈! 긴급 재탐색',
    'final_approach': '목적지 근접 (3분 전)',
    'arrived_building': '✅ 목적지 건물 진입 완료'
  };
  document.getElementById('hud-status').textContent = statusMap[alertLevel] || '안내 중';

  // JSON 인스펙터 갱신
  const responsePayload = {
    user_persona: currentPersona === 'mak' ? '막해일' : '길라임',
    reroute_required: routeState.rerouteRequired || node.alert_level === 'off_route_warning',
    current_imdf_id: nodeId,
    destination_id: destinationId,
    route_path: routePath,
    next_waypoint: nextNodeInfo.name,
    next_waypoint_four_word: nextNodeInfo.four_word,
    four_word_address: node.four_word,
    route_state: routeState,
    hud_action: {
      target_level: node.level_id,
      yaw_deg: node.yaw_deg,
      pitch_deg: node.pitch_deg,
      alert_level: alertLevel
    }
  };
  document.getElementById('json-output').textContent = JSON.stringify(responsePayload, null, 2);
}

// 채팅 메시지 추가
function appendMessage(sender, text, fourWord = '') {
  const chatBox = document.getElementById('chat-box');
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${sender}`;

  if (sender === 'ai' && fourWord) {
    msgDiv.innerHTML = `<div class="meta">${fourWord}</div><div>${text}</div>`;
  } else {
    msgDiv.textContent = text;
  }

  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// 사용자 메시지 처리
function processQuery(text) {
  if (!text.trim()) return;
  appendMessage('user', text);

  const nodeId = inferNodeFromText(text);
  const routeState = detectRouteDeviation(nodeId, text);
  currentRouteState = {
    ...routeState,
    lastUserText: text
  };

  const resolvedNodeId = routeState.nodeId;
  const node = imdfData.nodes[resolvedNodeId];
  updateHUD(resolvedNodeId);

  const routePath = findShortestPath(resolvedNodeId, imdfData.destination_id || 'opn-westin-lobby');
  const nextNode = routePath.length > 1 ? routePath[1] : routePath[0];
  const nextNodeInfo = imdfData.nodes[nextNode] || node;

  const routeHint = `📍 경로상 다음 목적지는 ${nextNodeInfo.name}입니다. 현재 경로: ${routePath.join(' → ')}.`;
  const rerouteMessage = routeState.rerouteRequired
    ? '🚨 경로 이탈이 감지되어 즉시 원래 경로로 재탐색합니다.'
    : '✅ 정상 경로를 유지하고 있습니다.';
  const reply = currentPersona === 'mak'
    ? `${node.guide_mak} ${rerouteMessage} ${routeHint}`
    : `${node.guide_gil} ${rerouteMessage} ${routeHint}`;

  setTimeout(() => {
    appendMessage('ai', reply, node.four_word);
  }, 300);
}

function handleUserSubmit() {
  const input = document.getElementById('user-input');
  processQuery(input.value);
  input.value = '';
}

function handleKeyPress(e) {
  if (e.key === 'Enter') handleUserSubmit();
}

function sendPreset(text) {
  processQuery(text);
}

window.onload = initApp;
