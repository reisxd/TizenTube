/*
 *  REST
 *
 * Copyright (c) 2000 - 2014 Samsung Electronics Co., Ltd. All rights reserved.
 *
 * Contact:
 * 
 * Daeryong Park <daeryong.park@samsung.com>
 * Hyunsik Noh <hyunsik.noh@samsung.com>
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Contributors:
 * - S-Core Co., Ltd
 *
 */

/**@brief
 * The root of REST API.
          <p>
This is the REST root interface.
          </p>
         
 *
 * @super Object
 * @constructor
 * @return {REST}
 */
function REST() {};
REST.prototype = new Object();

/**@brief
 * This supports REST APIs.
 * <p>
The API provides the basic methods that are used for asynchronous request.
These are using XMLHttpRequest object and support "GET", "POST" and "PUT", "DELETE" HTTP methods.
        </p>
 
 *
 * @type REST
 */
Window.prototype.rest = new REST();

/**@brief
 * Sends the asynchronous request.(GET method)
    <p>
    This API uses "GET" HTTP method to send the asynchronous request using XMLHttpRequest object.
    </p>
           
 * @param {String} url
 * @param {Array} header
 * @param {Array} data
 * @param {SuccessCallback} fSuccess
 * @param {ErrorCallback} fError
 * @type void
 * @memberOf REST
 * @returns {void}
 */

REST.prototype.get = function(url, header, data, fSuccess, fError) {
    if(!(url)) {
        return;
    }
    var xhr = new XMLHttpRequest();
    
    if(data) {
        var body = [];
        for(var p in data) {
            if(data.hasOwnProperty(p)) {
                body.push(encodeURIComponent(p) + "=" + encodeURIComponent(data[p]));
            }
        }
        var reqData = body.join("&");
        url += "?" + reqData;
    }
        
    xhr.open("GET", url, true);
    
    if(header) {
        for(var p in header) {
            if(header.hasOwnProperty(p)) {
                xhr.setRequestHeader(p, header[p]);
            }
        }
    }
    
    xhr.onreadystatechange = function (event) {
        if(xhr.readyState == 4) {
            var type = xhr.getResponseHeader("Content-type");
            var data = "";
            
            if(type.indexOf('application/json') == 0) {
                data = JSON.parse(xhr.responseText);
            } else if(type.indexOf('application/xml') == 0) {
                data = xhr.responseXML;
            } else {
                data = xhr.responseText;
            }
            
            if(xhr.status == 200) {
                fSuccess(data, xhr);
            } else {
                if(fError) {
                    fError(data, xhr);
                }
            }
        }
    };
    
   
    xhr.send();
};

/**@brief
 * Sends the asynchronous request.
    <p>
    This API uses "POST" HTTP method to send the asynchronous request using XMLHttpRequest object.
    </p>
           
 * @param {String} url
 * @param {Array} header
 * @param {Array} data
 * @param {SuccessCallback} fSuccess
 * @param {ErrorCallback} fError
 * @type void
 * @memberOf REST
 * @returns {void}
 */
REST.prototype.post = function (url, header, data, fSuccess, fError) {
    if(!(url)) {
        return;
    }
    
    var xhr = new XMLHttpRequest();
    
    xhr.open("POST", url, true);
    xhr.setRequestHeader('Content-type', 'application/json');
    
    if(header) {
        for(var p in header) {
            if(header.hasOwnProperty(p)) {
                xhr.setRequestHeader(p, header[p]);
            }
        }
    }
    
    xhr.onreadystatechange = function (event) {
        if(xhr.readyState == 4) {
            var type = xhr.getResponseHeader("Content-type");
            var data = "";
            
            if(type.indexOf('application/json') == 0) {
                data = JSON.parse(xhr.responseText);
            } else if(type.indexOf('application/xml') == 0) {
                data = xhr.responseXML;
            } else {
                data = xhr.responseText;
            }
            
            if(xhr.status == 200) {
                fSuccess(data, xhr);
            } else {
                if(fError) {
                    fError(data, xhr);
                }
            }
        }
    };
    
    if(data) {
        reqData = JSON.stringify(data);
        xhr.send(reqData);
    } else {
        xhr.send();
    }
};

/**@brief
 * Sends the asynchronous request with FormData.
    <p>
    This API uses "POST" HTTP method to send the asynchronous request using XMLHttpRequest object.
    </p>
           
 * @param {String} url
 * @param {Array} header
 * @param {Array} data(JSON)
 * @param {Array} fileInputElements
 * @param {SuccessCallback} fSuccess
 * @param {ErrorCallback} fError
 * @type void
 * @memberOf REST
 * @returns {void}
 */
REST.prototype.postFormData = function (url, header, data, file, fSuccess, fError) {
    if(!(url)) {
        return;
    }
    
    var xhr = new XMLHttpRequest();
    
    xhr.open("POST", url, true);
    
    if(header) {
        for(var p in header) {
            if(header.hasOwnProperty(p)) {
                xhr.setRequestHeader(p, header[p]);
            }
        }
    }
    
    xhr.onreadystatechange = function (event) {
        if(xhr.readyState == 4) {
            var type = xhr.getResponseHeader("Content-type");
            var data = "";
            
            if(type.indexOf('application/json') == 0) {
                data = JSON.parse(xhr.responseText);
            } else if(type.indexOf('application/xml') == 0) {
                data = xhr.responseXML;
            } else {
                data = xhr.responseText;
            }
            
            if(xhr.status == 200) {
                fSuccess(data, xhr);
            } else {
                if(fError) {
                    fError(data, xhr);
                }
            }
        }
    };
    
    if(data || file) {
        var formData = new FormData();
        if(data) {
            for(var p in data) {
                if(data.hasOwnProperty(p)) {
                    formData.append(p, data[p]);
                }
            }
        }
        if(file) {
            for(var p in file) {
                if(file.hasOwnProperty(p)) {
                    formData.append(p, file[p].files[0]);
                }
            }
        }
        xhr.send(formData);
    } else {
        xhr.send();
    }
};

/**@brief
 * Sends the asynchronous request.
    <p>
    This API uses "PUT" HTTP method to send the asynchronous request using XMLHttpRequest.
    </p>
           
 * @param {String} url
 * @param {Array} header
 * @param {Array} data
 * @param {SuccessCallback} fSuccess
 * @param {ErrorCallback} fError
 * @type void
 * @memberOf REST
 * @returns {void}
 */
REST.prototype.put = function (url, header, data, fSuccess, fError) {
    if(!(url)) {
        return;
    }
    
    var xhr = new XMLHttpRequest();
    
    xhr.open("PUT", url, true);
    xhr.setRequestHeader('Content-type', 'application/json');
    
    if(header) {
        for(var p in header) {
            if(header.hasOwnProperty(p)) {
                xhr.setRequestHeader(p, header[p]);
            }
        }
    }
    
    xhr.onreadystatechange = function (event) {
        if(xhr.readyState == 4) {
            var type = xhr.getResponseHeader("Content-type");
            var data = "";
            
            if(type.indexOf('application/json') == 0) {
                data = JSON.parse(xhr.responseText);
            } else if(type.indexOf('application/xml') == 0) {
                data = xhr.responseXML;
            } else {
                data = xhr.responseText;
            }
            
            if(xhr.status == 200) {
                fSuccess(data, xhr);
            } else {
                if(fError) {
                    fError(data, xhr);
                }
            }
        }
    };
    
    if(data) {
        reqData = JSON.stringify(data);
        xhr.send(reqData);
    } else {
        xhr.send();
    }
};

/**@brief
 * Sends the asynchronous request.
    <p>
    This API uses "DELETE" HTTP method to send the asynchronous request using XMLHttpRequest.
    </p>
           
 * @param {String} url
 * @param {Array} header
 * @param {Array} data
 * @param {SuccessCallback} fSuccess
 * @param {ErrorCallback} fError
 * @type void
 * @memberOf REST
 * @returns {void}
 */
REST.prototype.del = function (url, header, data, fSuccess, fError) {
    if(!(url)) {
        return;
    }
    
    var xhr = new XMLHttpRequest();
    
    xhr.open("DELETE", url, true);
    xhr.setRequestHeader('Content-type', 'application/json');
    
    if(header) {
        for(var p in header) {
            if(header.hasOwnProperty(p)) {
                xhr.setRequestHeader(p, header[p]);
            }
        }
    }
    
    xhr.onreadystatechange = function (event) {
        if(xhr.readyState == 4) {
            var type = xhr.getResponseHeader("Content-type");
            var data = "";
            
            if(type.indexOf('application/json') == 0) {
                data = JSON.parse(xhr.responseText);
            } else if(type.indexOf('application/xml') == 0) {
                data = xhr.responseXML;
            } else {
                data = xhr.responseText;
            }
            
            if(xhr.status == 200) {
                fSuccess(data, xhr);
            } else {
                if(fError) {
                    fError(data, xhr);
                }
            }
        }
    };
    
    if(data) {
        reqData = JSON.stringify(data);
        xhr.send(reqData);
    } else {
        xhr.send();
    }
};