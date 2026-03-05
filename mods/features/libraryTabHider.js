const getHiddenLibraryTabIds = (configured) => {
  if (!Array.isArray(configured) || configured.length === 0) return new Set();
  return new Set(configured.map((id) => String(id || '').toLowerCase()).filter(Boolean));
};

const matchesHiddenId = (value, hiddenIds) => {
  const id = String(value || '').toLowerCase();
  if (!id) return false;

  for (const hiddenId of hiddenIds) {
    if (id === hiddenId || id.includes(hiddenId)) return true;
  }

  return false;
};

const shouldHideTabItem = (item, hiddenIds) => {
  if (!item || typeof item !== 'object') return false;

  return matchesHiddenId(item?.tileRenderer?.contentId, hiddenIds)
    || matchesHiddenId(item?.tabRenderer?.content?.tvSurfaceContentRenderer?.content?.gridRenderer?.items?.[0]?.tileRenderer?.contentId, hiddenIds)
    || matchesHiddenId(item?.tabRenderer?.endpoint?.browseEndpoint?.browseId, hiddenIds)
    || matchesHiddenId(item?.navigationEndpoint?.browseEndpoint?.browseId, hiddenIds)
    || matchesHiddenId(item?.browseEndpoint?.browseId, hiddenIds);
};

const pruneLibraryTabs = (node, hiddenIds) => {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node?.horizontalListRenderer?.items)) {
    node.horizontalListRenderer.items = node.horizontalListRenderer.items.filter((item) => !shouldHideTabItem(item, hiddenIds));
  }

  if (Array.isArray(node?.continuationContents?.horizontalListContinuation?.items)) {
    node.continuationContents.horizontalListContinuation.items =
      node.continuationContents.horizontalListContinuation.items.filter((item) => !shouldHideTabItem(item, hiddenIds));
  }

  if (Array.isArray(node?.tvSecondaryNavSectionRenderer?.tabs)) {
    node.tvSecondaryNavSectionRenderer.tabs = node.tvSecondaryNavSectionRenderer.tabs.filter((tab) => !shouldHideTabItem(tab, hiddenIds));
  }

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === 'object') pruneLibraryTabs(entry, hiddenIds);
        }
      } else {
        pruneLibraryTabs(value, hiddenIds);
      }
    }
  }
};

export const applyLibraryTabHiding = (response, configuredHiddenIds) => {
  const hiddenIds = getHiddenLibraryTabIds(configuredHiddenIds);
  if (hiddenIds.size === 0) return;

  pruneLibraryTabs(response, hiddenIds);
};
