import { configChangeEmitter, configRead, configWrite } from "../config.js";
import getCommandExecutor from "./customCommandExecution.js";
import { GuideEntryRenderer } from "./ytUI.js";

const origParse = JSON.parse;
JSON.parse = function () {
    const r = origParse.apply(this, arguments);
    const guideSection = r.items?.[0]?.guideSectionRenderer;
    const order = configRead('sidebarContentsOrder');
    if (guideSection && Array.isArray(order)) {
        let orderChanged = false;
        for (const item of guideSection.items) {
            // Not every guide item is a guideEntryRenderer: a throw here would fail
            // the caller's JSON.parse and lose the whole guide response.
            const itemOrder = item.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId
                || (item.guideEntryRenderer?.navigationEndpoint?.searchEndpoint && 'search');
            if (itemOrder && !order.some(orderItem =>
                (typeof orderItem === 'object' ? orderItem.browseId : orderItem) === itemOrder)) {
                order.push(itemOrder);
                orderChanged = true;
            }
        }
        if (orderChanged) configWrite('sidebarContentsOrder', order);
    }
    if (configRead('sidebarContentsOrder')?.length === 0) {
       // Add all of the items in the sidebar to the sidebarContentsOrder
        if (r.items && Array.isArray(r.items) && r.items[0].guideSectionRenderer) {
            const order = [];
            for (const item of r.items[0].guideSectionRenderer.items) {
                const browseId = item.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
                if (browseId) {
                    order.push(browseId);
                } else if (item.guideEntryRenderer?.navigationEndpoint?.searchEndpoint) {
                    order.push('search');
                }
            }
            configWrite('sidebarContentsOrder', order);
        }
    } else {
        // Reorder the items based on the sidebarContentsOrder config key

        if (r.items && Array.isArray(r.items) && r.items[0].guideSectionRenderer) {
            const order = configRead('sidebarContentsOrder');
            const items = r.items[0].guideSectionRenderer.items;
            const copiedItems = JSON.parse(JSON.stringify(items));

            for (const orderItem of order) {
                if (typeof orderItem === 'object' && orderItem !== null) {
                    const customItem = GuideEntryRenderer(
                        orderItem.title,
                        {
                            browseEndpoint: {
                                browseId: orderItem.browseId
                            }
                        },
                        'PERSON'
                    );
                    copiedItems.push(customItem);
                }
            }

            const orderedItems = [];
            const placed = new Set();
            for (const orderItem of order) {
                const browseId = typeof orderItem === 'object' ? orderItem.browseId : orderItem;
                const index = copiedItems.findIndex(item => {
                    const itemBrowseId = item.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
                    return itemBrowseId === browseId || (browseId === 'search' && item.guideEntryRenderer?.navigationEndpoint?.searchEndpoint);
                });
                if (index !== -1) {
                    orderedItems.push(copiedItems[index]);
                    placed.add(index);
                }
            }
            // Entries the stored order knows nothing about must survive, after the
            // ordered ones. The order is not scoped to a profile: it is learned from
            // whichever profile loads first, and only from entries exposing a
            // browseEndpoint.browseId. A YouTube Kids profile's guide entries don't,
            // so they were neither learned above nor matched here — dropping them
            // emptied the whole left menu on that profile (#643, #648).
            copiedItems.forEach((item, index) => {
                if (!placed.has(index)) orderedItems.push(item);
            });
            r.items[0].guideSectionRenderer.items = orderedItems;
        }
    }

    const disabledSidebarContents = configRead('disabledSidebarContents');
    const disableChannelsOnSidebar = configRead('disableChannelsOnSidebar');
    if (r.items && Array.isArray(r.items) && r.items[0].guideSectionRenderer) {
        for (let i = 0; i < r.items.length; i++) {
            const section = r.items[i].guideSectionRenderer;
            section.originalItems = section.items.slice();
            for (let j = 0; j < section.items.length; j++) {
                const item = section.items[j].guideEntryRenderer;
                if (!item) continue;
                if ((disabledSidebarContents?.length &&
                    disabledSidebarContents.includes(item.navigationEndpoint?.browseEndpoint ?
                        item.navigationEndpoint.browseEndpoint.browseId :
                        'search'))
                    || (disableChannelsOnSidebar && item?.thumbnail)) {
                    section.items.splice(j, 1);
                    j--;
                }
            }
        }
    }

    return r;
}

configChangeEmitter.addEventListener('configChange', (e) => {
    if (e.detail.key === 'disabledSidebarContents' || e.detail.key === 'disableChannelsOnSidebar' || e.detail.key === 'sidebarContentsOrder') {
        const commandExecutor = getCommandExecutor();
        if (commandExecutor) {
            commandExecutor.executeFunction(new commandExecutor.commandFunction('reloadGuideAction'));
        }
    }
});