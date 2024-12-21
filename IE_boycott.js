var userAgent = window.navigator.userAgent.toLocaleLowerCase();
if (userAgent.indexOf('msie') != -1 || userAgent.indexOf('trident') != -1) {
    window.location.replace("do_not_use_ie.html")
}
