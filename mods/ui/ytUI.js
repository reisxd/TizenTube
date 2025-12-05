import resolveCommand from '../resolveCommand.js';

function showToast(title, subtitle, thumbnails) {
    const toastCmd = {
        openPopupAction: {
            popupType: 'TOAST',
            popup: {
                overlayToastRenderer: {
                    title: {
                        simpleText: title
                    },
                    subtitle: {
                        simpleText: subtitle
                    }
                }
            }
        }
    }

    if (thumbnails) {
        toastCmd.openPopupAction.popup.overlayToastRenderer.image.thumbnails = thumbnails;
    }
    resolveCommand(toastCmd);
}

function OverlayPanelHeaderRenderer(title, subtitle, thumbnails) {
    return {
        overlayPanelHeaderRenderer: {
            title: {
                simpleText: title
            },
            subtitle: {
                simpleText: subtitle
            },
            image: {
                thumbnails: thumbnails
            },
            style: "OVERLAY_PANEL_HEADER_STYLE_VIDEO_THUMBNAIL"
        }
    }
}

function Modal(header, content, id, update) {
    const titleSubtitleObj = typeof header === 'string' ? { title: header, subtitle: '' } : header;
    const overlayPanelHeaderRenderer = header.overlayPanelHeaderRenderer || {
        title: {
            simpleText: titleSubtitleObj.title
        }
    };
    const modalCmd = {
        openPopupAction: {
            popupType: 'MODAL',
            popup: {
                overlaySectionRenderer: {
                    overlay: {
                        overlayTwoPanelRenderer: {
                            actionPanel: {
                                overlayPanelRenderer: {
                                    header: {
                                        overlayPanelHeaderRenderer
                                    },
                                    content
                                }
                            },
                            backButton: {
                                buttonRenderer: {
                                    accessibilityData: {
                                        accessibilityData: {
                                            label: 'Back'
                                        }
                                    },
                                    command: {
                                        signalAction: {
                                            signal: 'POPUP_BACK'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    dismissalCommand: {
                        signalAction: {
                            signal: 'POPUP_BACK'
                        }
                    }
                }
            },
            uniqueId: id
        }
    }

    if (titleSubtitleObj.subtitle) {
        modalCmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.header.overlayPanelHeaderRenderer.subtitle = {
            simpleText: titleSubtitleObj.subtitle
        };
    }

    if (update) {
        modalCmd.openPopupAction.shouldMatchUniqueId = true;
        modalCmd.openPopupAction.updateAction = true;
    }

    return modalCmd;
}

function showModal(header, content, id, update) {
    const modalCmd = Modal(header, content, id, update);

    resolveCommand(modalCmd);
}

function overlayPanelItemListRenderer(items, selectedIndex) {
    return {
        overlayPanelItemListRenderer: {
            items,
            selectedIndex
        }
    }
};

function buttonItem(title, icon, commands) {
    const button = {
        compactLinkRenderer: {
            serviceEndpoint: {
                commandExecutorCommand: {
                    commands
                }
            }
        }
    }

    if (title) {
        button.compactLinkRenderer.title = {
            simpleText: title.title
        }
    }

    if (title.subtitle) {
        button.compactLinkRenderer.subtitle = {
            simpleText: title.subtitle
        }
    }

    if (icon) {
        button.compactLinkRenderer.icon = {
            iconType: icon.icon,
        }
    }

    if (icon && icon.secondaryIcon) {
        button.compactLinkRenderer.secondaryIcon = {
            iconType: icon.secondaryIcon,
        }
    }

    return button;
}


function timelyAction(text, icon, command, triggerTimeMs, timeoutMs) {
    return {
        timelyActionRenderer: {
            actionButtons: [
                {
                    buttonRenderer: {
                        isDisabled: false,
                        text: {
                            runs: [
                                {
                                    text: text
                                }
                            ]
                        },
                        icon: {
                            iconType: icon
                        },
                        trackingParams: null,
                        command
                    }
                }
            ],
            triggerTimeMs,
            timeoutMs,
            type: ''
        }
    }

}

function longPressData(data) {
    return {
        clickTrackingParams: null,
        showMenuCommand: {
            contentId: data.videoId,
            thumbnail: {
                thumbnails: data.thumbnails
            },
            title: {
                simpleText: data.title
            },
            subtitle: {
                simpleText: data.subtitle
            },
            menu: {
                menuRenderer: {
                    items: [
                        MenuNavigationItemRenderer('Play', {
                            clickTrackingParams: null,
                            watchEndpoint: data.watchEndpointData
                        }),
                        MenuServiceItemRenderer('Save to Watch Later', {
                            clickTrackingParams: null,
                            playlistEditEndpoint: {
                                playlistId: 'WL',
                                actions: [
                                    {
                                        addedVideoId: data.videoId,
                                        action: 'ACTION_ADD_VIDEO'
                                    }
                                ]
                            }
                        }),
                        MenuNavigationItemRenderer('Save to Playlist', {
                            clickTrackingParams: null,
                            addToPlaylistEndpoint: {
                                videoId: data.videoId
                            }
                        }),
                        MenuServiceItemRenderer('Add to Queue', {
                            clickTrackingParams: null,
                            playlistEditEndpoint: {
                                customAction: {
                                    action: 'ADD_TO_QUEUE',
                                    parameters: data.item
                                }
                            }
                        }),
                    ],
                    trackingParams: null,
                    accessibility: {
                        accessibilityData: {
                            label: 'Video options'
                        }
                    }
                }
            }
        }
    }
}

function MenuServiceItemRenderer(text, serviceEndpoint) {
    return {
        menuServiceItemRenderer: {
            text: {
                runs: [
                    {
                        text
                    }
                ]
            },
            serviceEndpoint,
            trackingParams: null
        }
    };
}

function MenuNavigationItemRenderer(text, navigateEndpoint) {
    return {
        menuNavigationItemRenderer: {
            text: {
                runs: [
                    {
                        text
                    }
                ]
            },
            navigationEndpoint: navigateEndpoint,
            trackingParams: null
        }
    }
}

function SettingsCategory(categoryId, items, title) {
    const category = {
        settingCategoryCollectionRenderer: {
            items,
            categoryId,
            focused: false,
            trackingParams: "null"
        }
    }

    if (title) {
        category.settingCategoryCollectionRenderer.title = {
            runs: [
                {
                    text: title
                }
            ]
        };
    }

    return category;
}

function SettingActionRenderer(title, itemId, serviceEndpoint, summary, thumbnail) {
    return {
        settingActionRenderer: {
            title: {
                runs: [
                    {
                        text: title
                    }
                ]
            },
            serviceEndpoint,
            summary: {
                runs: [
                    {
                        text: summary
                    }
                ]
            },
            trackingParams: "null",
            actionLabel: {
                runs: [
                    {
                        text: title
                    }
                ]
            },
            itemId,
            thumbnail: {
                thumbnails: [
                    {
                        url: thumbnail
                    }
                ]
            }
        }
    }
}

function scrollPaneRenderer(items) {
    return {
        scrollPaneRenderer: {
            content: {
                scrollPaneItemListRenderer: {
                    items
                }
            }
        }
    }
}

function overlayMessageRenderer(simpleText) {
    return {
        overlayMessageRenderer: {
            title: {
                simpleText
            }
        }
    }
}

function ShelfRenderer(simpleText, items, selectedIndex = 0) {
    return {
        shelfRenderer: {
            shelfHeaderRenderer: {
                title: {
                    simpleText
                }
            },
            tvhtml5ShelfRendererType: "TVHTML5_SHELF_RENDERER_TYPE_GRID",
            content: {
                horizontalListRenderer: {
                    items,
                    selectedIndex,
                    visibleItemCount: 3
                }
            }
        }
    }
}

function TileRenderer(simpleText, onSelectCommand) {
    return {
        tileRenderer: {
            contentType: "TILE_CONTENT_TYPE_VIDEO",
            metadata: {
                tileMetadataRenderer: {
                    title: {
                        simpleText
                    }
                }
            },
            onSelectCommand,
            style: "TILE_STYLE_YTLR_DEFAULT"
        }
    }
}

export {
    showToast,
    Modal,
    OverlayPanelHeaderRenderer,
    showModal,
    buttonItem,
    overlayPanelItemListRenderer,
    overlayMessageRenderer,
    timelyAction,
    scrollPaneRenderer,
    longPressData,
    MenuServiceItemRenderer,
    SettingsCategory,
    SettingActionRenderer,
    ShelfRenderer,
    TileRenderer
}