const AppState = {
  currentPage: "dashboard",
  kg: {
    nodes: [],
    edges: [],
    loaded: false,
  },
  documents: [],
  activeJobs: {},
  chatHistory: [],
  conversation: [],
  knowledgeBases: [],
  agents: [],
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
