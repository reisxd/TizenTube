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

function showModal(titleAndSubtitle, content, id, update) {
    const titleSubtitleObj = typeof titleAndSubtitle === 'string' ? { title: titleAndSubtitle, subtitle: '' } : titleAndSubtitle;
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
                                        overlayPanelHeaderRenderer: {
                                            title: {
                                                simpleText: titleSubtitleObj.title
                                            }
                                        }
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
                        {
                            menuNavigationItemRenderer: {
                                text: {
                                    runs: [
                                        {
                                            text: 'Play'
                                        }
                                    ]
                                },
                                navigationEndpoint: {
                                    clickTrackingParams: null,
                                    watchEndpoint: data.watchEndpointData
                                },
                                trackingParams: null
                            }
                        },
                        {
                            menuServiceItemRenderer: {
                                text: {
                                    runs: [
                                        {
                                            text: 'Save to Watch Later'
                                        }
                                    ]
                                },
                                serviceEndpoint: {
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
                                },
                                trackingParams: null
                            }
                        },
                        {
                            menuNavigationItemRenderer: {
                                text: {
                                    runs: [
                                        {
                                            text: 'Save to playlist'
                                        }
                                    ]
                                },
                                navigationEndpoint: {
                                    clickTrackingParams: null,
                                    addToPlaylistEndpoint: {
                                        videoId: data.videoId
                                    }
                                },
                                trackingParams: null
                            }
                        }
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

export {
    showToast,
    showModal,
    buttonItem,
    overlayPanelItemListRenderer,
    overlayMessageRenderer,
    timelyAction,
    scrollPaneRenderer,
    longPressData,
    SettingsCategory,
    SettingActionRenderer
}