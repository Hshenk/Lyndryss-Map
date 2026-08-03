/**
 * Session storage - one sign-in across every lyndryss.com site. 
 * 
 * supabase-js keeps its session in local storage 
 */

const COOKIE_DOMAIN = window.location.hostname.endsWith("lyndryss.com")
    ? "; domain=.lyndryss.com"
    : "";
const COOKIE_SECURE = window.location.protocol === "https:" ? "; Secure" : "";
const ONE_YEAR = 60 * 60 * 24 * 365;

// Cookies dies past 4096 bytes 
const CHUNK_SIZE = 1500;

function readCookie(name) {
    for (const part of document.cookie.split("; ")) {
        const eq = part.indexOf("=");
        if (part.slice(0, eq) === name) {
            return decodeURIComponent(part.slice(eq + 1));
        }
    }
    
    return null;
}

function writeCookie(name, value) {
    document.cookie = name + "=" + encodeURIComponent(value)
        + "; path=/" + COOKIE_DOMAIN + COOKIE_SECURE
        + "; SameSite=LAX; max-age=" + ONE_YEAR;
}

function clearChunks(key) {
    for (let i = 0; readCookie(key + "." + i) !== null; i++) {
        document.cookie = key + "." + i + "=; path=/" + COOKIE_DOMAIN
            + COOKIE_SECURE + "; SameSite=LAX; max-age=0";
    }
}

export const cookieStorage = {
    getItem(key) {
        const chunks = [];
        for (let i = 0; ; i++) {
            const chunk = readCookie(key + "." + i);
            if (chunk === null) {
                break;
            }
            chunks.push(chunk);
        }
        if (chunks.length > 0) {
            return chunks.join("");
        }

        // No cookie yet - adopt a session the previous built left in local storage
        const previous = window.localStorage.getItem(key);
        window.localStorage.removeItem(key);
        return previous;
    },

    setItem(key, value) {
        clearChunks(key);
        for (let i = 0; i * CHUNK_SIZE < value.length; i++) {
            const start = i * CHUNK_SIZE;
            writeCookie(key + "." + i, value.slice(start, start + CHUNK_SIZE));
        }
    },

    removeItem(key) {
        clearChunks(key);
        window.localStorage.removeItem(key);
    },
};