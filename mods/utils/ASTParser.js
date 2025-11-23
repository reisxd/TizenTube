// AST Parser for TizenTube, used for finding code patterns
// You may call me insane for this.

import esprima from 'esprima';
import estraverse from 'estraverse';

// Extract assignment RHS sources and inner returned functions (IIFEs)
export function extractAssignedFunctions(code) {
    const original = code;
    let wrapOffset = 0;
    let ast;

    try {
        ast = esprima.parse(code, { range: true, tolerant: true, sourceType: 'script' });
    } catch (e1) {
        try {
            const wrapped = '(' + code + ')';
            ast = esprima.parse(wrapped, { range: true, tolerant: true, sourceType: 'script' });
            wrapOffset = 1;
        } catch (e2) {
            try {
                ast = esprima.parse(code, { range: true, tolerant: true, sourceType: 'module' });
            } catch (e3) {
                try {
                    const wrapped2 = '(' + code + ')';
                    ast = esprima.parse(wrapped2, { range: true, tolerant: true, sourceType: 'module' });
                    wrapOffset = 1;
                } catch (e4) {
                    throw e1;
                }
            }
        }
    }

    const out = [];

    estraverse.traverse(ast, {
        enter: function (node) {
            if (node.type !== 'AssignmentExpression') return;
            const rhs = node.right;
            if (!rhs || !rhs.range) return;
            const rhsSrc = original.slice(rhs.range[0] - wrapOffset, rhs.range[1] - wrapOffset);
            let inner = null;

            if (rhs.type === 'CallExpression' && rhs.callee && rhs.callee.type === 'FunctionExpression' && rhs.callee.body) {
                let stm = rhs.callee.body.body || [];
                for (let i = 0; i < stm.length; i++) {
                    let s = stm[i];
                    if (s.type === 'ReturnStatement' && s.argument && s.argument.range) {
                        inner = original.slice(s.argument.range[0] - wrapOffset, s.argument.range[1] - wrapOffset);
                        break;
                    }
                }
            } else if (rhs.type === 'FunctionExpression' || rhs.type === 'ArrowFunctionExpression') {
                inner = rhsSrc;
            }

            out.push({
                left: node.left && node.left.range ? original.slice(node.left.range[0] - wrapOffset, node.left.range[1] - wrapOffset) : null,
                rhs: rhsSrc,
                returned: inner
            });
        }
    });

    return out;
}