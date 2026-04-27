# Zadarma API Signature Algorithm

## ⚠️ WAŻNE: Błąd który trzeba unikać

**BŁĄD (❌ NIE RÓB TEGO):**
```javascript
// ŹRÓDŁO BŁĘDU: base64(binary_hmac)
const signature = crypto.createHmac('sha1', SECRET)
  .update(signString)
  .digest('base64');  // ← BŁĄD! Zwraca base64 z binary HMAC
```

**POPRAWNIE (✅ RÓB TO):**
```javascript
// PRAWIDŁOWO: base64(hex_hmac)
const hexSignature = crypto.createHmac('sha1', SECRET)
  .update(signString)
  .digest('hex');  // ← Zwraca HEX string
return Buffer.from(hexSignature).toString('base64');  // ← Koduj HEX w base64
```

## Dlaczego?

Zadarma API implementuje algorytm zgodnie z PHP:

```php
$sign = base64_encode(hash_hmac('sha1', $data, $secret));
```

W PHP:
- `hash_hmac()` **domyślnie zwraca HEX string** (nie binary)
- `base64_encode()` koduje ten HEX string

## Pełny algorytm

1. **Sortuj parametry** alfabetycznie
2. **Zbuduj query string**: `key1=value1&key2=value2`
3. **Oblicz MD5** z query string (HEX format)
4. **Utwórz string do podpisu**: `METHOD + query_string + md5_hex`
5. **Oblicz HMAC-SHA1** (HEX format!)
6. **Koduj HEX w base64**
7. **Wyślij nagłówek**: `Authorization: KEY:SIGNATURE`

## Przykład

```javascript
const crypto = require('crypto');

const KEY = '80fb966e516fd1ac565e';
const SECRET = 'fde11f66f6eb8372080f';
const METHOD = '/v1/info/balance/';
const PARAMS = {};

// 1. Sort & build query string
const sortedKeys = Object.keys(PARAMS).sort();
const paramString = sortedKeys.map(k => `${k}=${PARAMS[k]}`).join('&');

// 2. MD5 of params
const md5Hash = crypto.createHash('md5').update(paramString).digest('hex');

// 3. Sign string
const signString = `${METHOD}${paramString}${md5Hash}`;

// 4. HMAC-SHA1 (HEX!)
const hexSignature = crypto.createHmac('sha1', SECRET)
  .update(signString)
  .digest('hex');

// 5. Base64 of HEX
const signature = Buffer.from(hexSignature).toString('base64');

// 6. Header
const header = `Authorization: ${KEY}:${signature}`;
```

## Zapamiętaj

> **base64(hmac_hex) ≠ base64(hmac_binary)**
>
> Zadarma wymaga: `base64(hmac_hex)`

## Testy

- ✅ `/v1/info/balance/` - powinno zwrócić balance
- ✅ `/v1/request/callback/` - click-to-call
- ✅ Webhooks - weryfikacja signatury
