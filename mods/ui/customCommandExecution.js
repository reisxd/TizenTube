function getCommandExecutor() {
    let instance;
    let executeFunction;

    for (const key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].getInstance) {
            if (window._yttv[key].toString().includes('ytlrActionRouter')) instance = window._yttv[key].getInstance();
            else {
                let isInstance = false;
                const tempInstance = window._yttv[key].getInstance();
                const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(tempInstance));
                for (const key of keys) {
                    if (typeof tempInstance[key] === 'function' && tempInstance[key].toString().includes('ytlrActionRouter')) {
                        executeFunction = tempInstance[key];
                        isInstance = true;
                    }
                }

                if (isInstance) instance = window._yttv[key].getInstance();
            }
        }
    }

    if (!instance) return;

    if (!executeFunction) {
        const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(instance));
        for (const key of keys) {
            if (typeof instance[key] === 'function' && instance[key].toString().includes('ytlrActionRouter')) {
                executeFunction = instance[key];
            }
        }
    }

    if (!executeFunction) return;

    let commandFunction;
    for (const key in window._yttv) {
        if (window._yttv[key] && typeof window._yttv[key] === 'function' && window._yttv[key].toString().includes('this.actionName')) {
            commandFunction = window._yttv[key];
        }
    }
    return {
        executeFunction: executeFunction.bind(instance),
        commandFunction
    }
}

export default getCommandExecutor;