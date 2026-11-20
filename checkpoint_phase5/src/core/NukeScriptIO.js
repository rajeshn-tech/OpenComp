/**
 * OpenComp - Foundry Nuke (.nk) Script Import & Export Engine
 * Generates and parses standard Foundry Nuke ASCII .nk scripts with full stack-based DAG connection preservation.
 */

export class NukeScriptIO {
  static exportToNuke(graph) {
    return NukeScriptIO.exportToNukeScript(graph);
  }

  static importFromNuke(scriptText, arg2, arg3) {
    if (typeof arg2 === 'function') {
      return NukeScriptIO.parseNukeScript(scriptText, arg2, arg3);
    } else {
      return NukeScriptIO.parseNukeScript(scriptText, arg3, arg2);
    }
  }

  static importFromNukeScript(scriptText, arg2, arg3) {
    return NukeScriptIO.importFromNuke(scriptText, arg2, arg3);
  }

  /**
   * Export OpenComp Graph to authentic Foundry Nuke .nk script with stack connections
   * @param {import('./Graph.js').Graph} graph 
   * @returns {string} Nuke script text
   */
  static exportToNukeScript(graph) {
    const nodes = graph.getAllNodes();
    let script = '';

    // Standard Foundry Nuke Script Header
    script += `#! /usr/local/Nuke14.0v1/libnuke-14.0.1.so -nx\n`;
    script += `version 14.0 v1\n`;
    script += `define_window_layout_xml {<layout version="1.0">...</layout>}\n`;
    script += `Root {\n`;
    script += ` inputs 0\n`;
    script += ` name "OpenComp_Production_Script"\n`;
    script += ` format "1920 1080 0 0 1920 1080 1 HD_1080"\n`;
    script += ` proxy_type scale\n`;
    script += ` proxy_scale 0.5\n`;
    script += `}\n`;

    // Emit nodes
    for (const node of nodes) {
      const type = node.type;
      let nukeType = type;

      // Nuke naming conventions
      if (type === 'Merge') nukeType = 'Merge2';
      else if (type === 'Keyer') nukeType = 'Primatte';
      else if (type === 'Transform') nukeType = 'Transform';
      else if (type === 'CornerPin') nukeType = 'CornerPin2D';
      else if (type === 'ZDefocus') nukeType = 'ZDefocus2';
      else if (type === 'Backdrop') nukeType = 'BackdropNode';

      // Push upstream inputs onto Nuke stack
      const connectedInputs = node.inputs.filter(inp => inp.connection && inp.connection.nodeId);
      
      // For multi-input nodes like Merge, Nuke stack order: B pushed first, then A
      if (type === 'Merge') {
        const inpB = node.inputs.find(i => i.id === 'B' && i.connection);
        const inpA = node.inputs.find(i => i.id === 'A' && i.connection);
        const inpMask = node.inputs.find(i => i.id === 'mask' && i.connection);

        if (inpB) script += `push $N_${inpB.connection.nodeId}\n`;
        if (inpA) script += `push $N_${inpA.connection.nodeId}\n`;
        if (inpMask) script += `push $N_${inpMask.connection.nodeId}\n`;
      } else if (type === 'ZDefocus') {
        const inpIn = node.inputs.find(i => i.id === 'in' && i.connection);
        const inpDepth = node.inputs.find(i => i.id === 'depth' && i.connection);
        if (inpIn) script += `push $N_${inpIn.connection.nodeId}\n`;
        if (inpDepth) script += `push $N_${inpDepth.connection.nodeId}\n`;
      } else if (type === 'Switch') {
        for (let i = 0; i <= 4; i++) {
          const inp = node.inputs.find(inp => inp.id === String(i) && inp.connection);
          if (inp) script += `push $N_${inp.connection.nodeId}\n`;
        }
      } else if (connectedInputs.length > 0) {
        for (const inp of connectedInputs) {
          script += `push $N_${inp.connection.nodeId}\n`;
        }
      }

      script += `${nukeType} {\n`;
      script += ` inputs ${connectedInputs.length}\n`;

      // Parameters (Knobs)
      for (const [key, knob] of Object.entries(node.knobs)) {
        if (knob.value !== undefined && knob.value !== null) {
          script += ` ${key} ${knob.value}\n`;
        }
      }

      // Nuke node positions & name
      const nodeName = node.name || node.id;
      script += ` name ${nodeName}\n`;
      script += ` xpos ${Math.round(node.x)}\n`;
      script += ` ypos ${Math.round(node.y)}\n`;
      if (node.disabled) {
        script += ` disable true\n`;
      }
      script += `}\n`;

      // Save stack handle for downstream references
      script += `set N_${node.id} [stack 0]\n`;
    }

    return script;
  }

  /**
   * Parse a Foundry Nuke (.nk) script into OpenComp graph with full DAG connections
   * @param {string} scriptText 
   * @param {Function} nodeFactory (type, id, x, y) => Node
   * @param {import('./Graph.js').Graph} [targetGraph]
   * @returns {Array<Object>} Node instances
   */
  static parseNukeScript(scriptText, nodeFactory, targetGraph = null) {
    const lines = scriptText.split('\n');
    const nodes = [];
    let currentNode = null;
    let nodeProps = {};

    const stack = [];
    const varMap = {};
    const createdNodes = new Map();

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      if (line.startsWith('set ') && line.includes('[stack 0]')) {
        const parts = line.split(/\s+/);
        const varName = parts[1];
        if (stack.length > 0) {
          varMap[varName] = stack[stack.length - 1];
        }
        continue;
      }

      if (line.startsWith('push $')) {
        const varName = line.replace('push $', '').trim();
        if (varMap[varName]) {
          stack.push(varMap[varName]);
        }
        continue;
      }

      if (line.endsWith('{')) {
        const typeStr = line.replace('{', '').trim();
        if (typeStr !== 'Root' && !typeStr.includes('layout')) {
          currentNode = typeStr;
          nodeProps = { type: typeStr, knobs: {} };
        }
      } else if (line === '}') {
        if (currentNode && nodeProps) {
          // Normalize Nuke type to OpenComp type
          let openCompType = nodeProps.type;
          if (openCompType === 'Merge2') openCompType = 'Merge';
          else if (openCompType === 'CornerPin2D') openCompType = 'CornerPin';
          else if (openCompType === 'Primatte') openCompType = 'Keyer';
          else if (openCompType === 'BackdropNode') openCompType = 'Backdrop';
          else if (openCompType === 'ZDefocus2') openCompType = 'ZDefocus';

          // Knob aliases
          if (openCompType === 'FrameHold' && nodeProps.knobs['first_frame'] !== undefined && nodeProps.knobs['firstFrame'] === undefined) {
            nodeProps.knobs['firstFrame'] = nodeProps.knobs['first_frame'];
          }
          if (openCompType === 'ZDefocus') {
            if (nodeProps.knobs['size'] !== undefined && nodeProps.knobs['maxDefocus'] === undefined) {
              nodeProps.knobs['maxDefocus'] = nodeProps.knobs['size'];
            }
            if (nodeProps.knobs['aspect'] !== undefined && nodeProps.knobs['aspectRatio'] === undefined) {
              nodeProps.knobs['aspectRatio'] = nodeProps.knobs['aspect'];
            }
          }

          const x = Number(nodeProps.xpos) || 100;
          const y = Number(nodeProps.ypos) || 100;
          const id = nodeProps.name || `${openCompType}_${nodes.length + 1}`;

          const node = nodeFactory(openCompType, id, x, y);
          if (node) {
            for (const [k, v] of Object.entries(nodeProps.knobs)) {
              node.setKnobValue(k, v);
            }
            if (nodeProps.disable === 'true' || nodeProps.disable === true) {
              node.disabled = true;
            }

            nodes.push(node);
            createdNodes.set(node.id, node);
            if (targetGraph) {
              targetGraph.addNode(node);
            }

            // Reconstruct DAG connections based on Nuke inputs stack
            const inputCount = Number(nodeProps.inputs) ?? 1;
            if (targetGraph && inputCount > 0) {
              if (openCompType === 'Merge' && inputCount >= 2) {
                // Stack convention: A popped first, B popped second
                const srcA = stack.pop();
                const srcB = stack.pop();
                if (srcB) targetGraph.connect(srcB.id, 'out', node.id, 'B');
                if (srcA) targetGraph.connect(srcA.id, 'out', node.id, 'A');
              } else if (openCompType === 'ZDefocus' && inputCount >= 2) {
                const srcDepth = stack.pop();
                const srcIn = stack.pop();
                if (srcIn) targetGraph.connect(srcIn.id, 'out', node.id, 'in');
                if (srcDepth) targetGraph.connect(srcDepth.id, 'out', node.id, 'depth');
              } else if (openCompType === 'Switch' && inputCount > 0) {
                const popped = [];
                for (let i = 0; i < inputCount && stack.length > 0; i++) {
                  popped.push(stack.pop());
                }
                popped.reverse();
                for (let i = 0; i < popped.length; i++) {
                  if (popped[i]) targetGraph.connect(popped[i].id, 'out', node.id, String(i));
                }
              } else if (stack.length > 0) {
                const src = stack.pop();
                if (src) {
                  const targetPort = node.inputs.find(inp => inp.id === 'in' || inp.id === 'B' || inp.id === '0') || node.inputs[0];
                  if (targetPort) {
                    targetGraph.connect(src.id, 'out', node.id, targetPort.id);
                  }
                }
              }
            }

            // Push this new node onto stack
            stack.push(node);
            varMap[node.id] = node;
            varMap[`N_${node.id}`] = node;
            varMap[node.name] = node;
          }
        }
        currentNode = null;
        nodeProps = {};
      } else if (currentNode) {
        const parts = line.split(/\s+/);
        const key = parts[0];
        let val = parts.slice(1).join(' ').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('{') && val.endsWith('}'))) {
          val = val.slice(1, -1);
        }

        if (key === 'xpos') nodeProps.xpos = val;
        else if (key === 'ypos') nodeProps.ypos = val;
        else if (key === 'name') nodeProps.name = val;
        else if (key === 'disable') nodeProps.disable = (val === 'true' || val === true);
        else if (key === 'inputs') nodeProps.inputs = val;
        else {
          let parsedVal = isNaN(Number(val)) ? val : Number(val);
          if (val === 'true') parsedVal = true;
          else if (val === 'false') parsedVal = false;
          nodeProps.knobs[key] = parsedVal;
        }
      }
    }

    return nodes;
  }
}
