import { configChangeEmitter, configRead } from "../config.js";
import getCommandExecutor from "./customCommandExecution.js";

const origParse = JSON.parse;
JSON.parse = function () {
    const r = origParse.apply(this, arguments);

    try {
        const disabledSidebarContents = configRead('disabledSidebarContents');
        // Guard: r.items[0] may not exist, or may not have guideSectionRenderer
        if (r.items && Array.isArray(r.items) && r.items[0] && r.items[0].guideSectionRenderer) {
            for (let i = 0; i < r.items.length; i++) {
                try {
                    const section = r.items[i].guideSectionRenderer;
                    if (!section || !Array.isArray(section.items)) continue;
                    for (let j = 0; j < section.items.length; j++) {
                        try {
                            const item = section.items[j].guideEntryRenderer;
                            if (!item) continue;
                            if (!item.icon?.iconType) continue;
                            if (disabledSidebarContents.includes(item.icon.iconType)) {
                                section.items.splice(j, 1);
                                j--;
                            }
                        } catch (itemErr) {
                            console.warn('[customGuideAction] Item processing error at index', j, itemErr);
                        }
                    }
                } catch (sectionErr) {
                    console.warn('[customGuideAction] Section processing error at index', i, sectionErr);
                }
            }
        }
    } catch (err) {
        console.warn('[customGuideAction] JSON.parse patch failed:', err);
    }

    return r;
};

configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail.key === 'disabledSidebarContents') {
        try {
            const commandExecutor = getCommandExecutor();
            if (commandExecutor) {
                commandExecutor.executeFunction(new commandExecutor.commandFunction('reloadGuideAction'));
            }
        } catch (err) {
            console.warn('[customGuideAction] reloadGuideAction failed:', err);
        }
    }
});