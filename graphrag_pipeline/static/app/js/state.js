function createConversationId() {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `conv_${random.replaceAll("-", "").slice(0, 16)}`;
}

const AppState = {
  currentPage: "dashboard",
  kg: {
    nodes: [],
    edges: [],
    loaded: false,
    scope: "",
  },
  documents: [],
  activeJobs: {},
  chatHistory: [],
  conversation: [],
  conversationId: createConversationId(),
  knowledgeBases: [],
  agents: [],
  agentTools: [],
  health: null,
  stats: null,
};

const Events = {
  listeners: {},
  on(name, handler) {
    this.listeners[name] = this.listeners[name] || new Set();
    this.listeners[name].add(handler);
    return () => this.listeners[name].delete(handler);
  },
  emit(name, payload) {
    (this.listeners[name] || []).forEach((handler) => handler(payload));
  },
};
