import { configChangeEmitter, configRead } from "../config.js";
import getCommandExecutor from "./customCommandExecution.js";

const origParse = JSON.parse;
JSON.parse = function () {
    const r = origParse.apply(this, arguments);

    const disabledSidebarContents = configRead('disabledSidebarContents');
    if (r.items && Array.isArray(r.items) && r.items[0].guideSectionRenderer) {
        for (let i = 0; i < r.items.length; i++) {
            const section = r.items[i].guideSectionRenderer;
            for (let j = 0; j < section.items.length; j++) {
                const item = section.items[j].guideEntryRenderer;
                if (!item) continue;
                if (disabledSidebarContents.includes(item.icon.iconType)) {
                    section.items.splice(j, 1);
                    j--;
                }
            }
        }
    }

    return r;
}

configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail.key === 'disabledSidebarContents') {
        const commandExecutor = getCommandExecutor();
        if (commandExecutor) {
            commandExecutor.executeFunction(new commandExecutor.commandFunction('reloadGuideAction'));
        }
    }
});