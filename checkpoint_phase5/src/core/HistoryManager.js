/**
 * OpenComp - Undo/Redo Graph History Manager
 * Maintains state snapshots for full non-destructive Undo (Ctrl+Z) and Redo (Ctrl+Y).
 */

export class HistoryManager {
  constructor(maxHistory = 50) {
    this.maxHistory = maxHistory;
    this.undoStack = [];
    this.redoStack = [];
    this.isApplying = false;
  }

  /**
   * Save a snapshot of the current graph state
   * @param {import('./Graph.js').Graph} graph 
   */
  pushState(graph) {
    if (this.isApplying) return;
    const snapshot = JSON.stringify(graph.serialize());

    // Avoid duplicate adjacent states
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === snapshot) {
      return;
    }

    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo on new action
  }

  /**
   * Undo to previous state
   * @param {import('./Graph.js').Graph} graph 
   * @param {Function} nodeFactory 
   * @returns {boolean} True if state was restored
   */
  undo(graph, nodeFactory) {
    if (this.undoStack.length <= 1) return false;

    this.isApplying = true;
    try {
      const currentState = this.undoStack.pop();
      this.redoStack.push(currentState);

      const targetState = JSON.parse(this.undoStack[this.undoStack.length - 1]);
      graph.deserialize(targetState, nodeFactory);
      return true;
    } finally {
      this.isApplying = false;
    }
  }

  /**
   * Redo to next state
   * @param {import('./Graph.js').Graph} graph 
   * @param {Function} nodeFactory 
   * @returns {boolean} True if state was restored
   */
  redo(graph, nodeFactory) {
    if (this.redoStack.length === 0) return false;

    this.isApplying = true;
    try {
      const nextState = this.redoStack.pop();
      this.undoStack.push(nextState);

      const targetState = JSON.parse(nextState);
      graph.deserialize(targetState, nodeFactory);
      return true;
    } finally {
      this.isApplying = false;
    }
  }
}

