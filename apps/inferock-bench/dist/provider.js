export const PROVIDER_NAMES = ["openai", "anthropic", "gemini", "openrouter"];
export function isProviderName(value) {
    return value !== undefined && PROVIDER_NAMES.includes(value);
}
export function providerDisplayName(provider) {
    if (provider === "openai")
        return "OpenAI";
    if (provider === "anthropic")
        return "Anthropic";
    if (provider === "gemini")
        return "Gemini";
    return "OpenRouter";
}
export function providerKeyShapeDescription(provider) {
    if (provider === "openai")
        return "an OpenAI key starting with sk-";
    if (provider === "anthropic")
        return "an Anthropic key starting with sk-ant-";
    if (provider === "gemini")
        return "a Gemini or Google AI key starting with AIza or AQ.";
    return "an OpenRouter key starting with sk-or-";
}
export function providerApiKeyShapeResult(provider, value) {
    const trimmed = value.trim();
    if (trimmed.length < 12)
        return { ok: false };
    if (provider === "openai")
        return { ok: /^sk-[A-Za-z0-9_-]{8,}$/.test(trimmed) };
    if (provider === "anthropic")
        return { ok: /^sk-ant-[A-Za-z0-9_-]{8,}$/.test(trimmed) };
    if (provider === "openrouter")
        return { ok: /^sk-or-[A-Za-z0-9_-]{8,}$/.test(trimmed) };
    if (/^AIza[A-Za-z0-9_-]{35}$/.test(trimmed))
        return { ok: true };
    if (/^AQ\.[A-Za-z0-9_-]{16,}$/.test(trimmed))
        return { ok: true };
    // Constraint: Gemini setup shape checks are typo guards, not a fail-closed allowlist of every future Google key shape.
    if (isGooglePlausibleUnknownGeminiKey(trimmed)) {
        return {
            ok: true,
            requiresInteractiveConfirmation: true,
            warning: "Gemini key shape is not a known AIza or AQ. format; Google may issue new key shapes, so interactive setup can save it after confirmation.",
        };
    }
    return { ok: false };
}
function isGooglePlausibleUnknownGeminiKey(value) {
    if (value.startsWith("sk-"))
        return false;
    if (!/^(?:Google|GOOGLE_|GEMINI_|GOCSPX-|ya29\.)[A-Za-z0-9_.-]{16,}$/.test(value))
        return false;
    return !/^[a-z]+(?:-[a-z]+){3,}$/.test(value);
}
//# sourceMappingURL=provider.js.map