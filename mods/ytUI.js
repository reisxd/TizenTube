import resolveCommand from './resolveCommand.js';

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

function showModal(title, content, selectIndex, id, update) {
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
                                                simpleText: title
                                            }
                                        }
                                    },
                                    content: {
                                        overlayPanelItemListRenderer: {
                                            items: content,
                                            selectedIndex: selectIndex
                                        }
                                    }
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

    if (update) {
        modalCmd.openPopupAction.shouldMatchUniqueId = true;
        modalCmd.openPopupAction.updateAction = true;
    }

    resolveCommand(modalCmd);
}

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

export {
    showToast,
    showModal,
    buttonItem
}