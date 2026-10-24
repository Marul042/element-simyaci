# Element Simyacısı

Bilim ve teknoloji sentezi web oyunu.

## AI API anahtarlarını güvenli kullanma

API anahtarları statik HTML'e veya GitHub Pages ayarlarına eklenmemelidir. `worker/` içindeki Cloudflare Worker, Groq ve Gemini isteklerini anahtarları tarayıcıya göndermeden iletir.

1. Sızmış olabilecek eski Groq ve Gemini anahtarlarını sağlayıcı panellerinden iptal edip yenilerini oluşturun.
2. Wrangler'ı kullanarak Cloudflare hesabınıza giriş yapın: `npx wrangler login`.
3. Yeni anahtarları Worker secret'ı olarak ekleyin; komut sizden değeri güvenli biçimde ister:
   - `npx wrangler secret put GROQ_API_KEY`
   - `npx wrangler secret put GEMINI_API_KEY`
4. Worker'ı dağıtın: `npx wrangler deploy`.
5. Cloudflare, dağıtım sonunda Worker URL'sini verir. Uygulamadaki **Ayarlar → Cloudflare Worker URL'si** alanına bu adresi kaydedin.

`wrangler.toml` içindeki `ALLOWED_ORIGINS`, GitHub Pages sitesinin origin'ine ayarlanmıştır. Özel alan adı kullanıyorsanız kendi origin'inizle değiştirin. Bu CORS kontrolü tek başına erişim kontrolü değildir: Worker URL'si herkese açık olacağından Cloudflare panelinde Worker hostname'i için IP başına bir rate limiting kuralı da oluşturun; ayrıca sağlayıcı panellerinde harcama/kullanım limitleri belirleyin.

Siteyi ziyaret eden herkesin URL'yi elle girmemesi için dağıtımdan sonra `index.html` içindeki `DEFAULT_AI_PROXY_URL` değerini Worker URL'siyle doldurup Pages'i yeniden dağıtın. URL herkese açık olabilir; API anahtarları olamaz. Boş bırakırsanız her tarayıcıda **Ayarlar** bölümünden Worker URL'si girilmelidir. Tarayıcı ayarlarında API anahtarı tutulmaz.
