import {
  AgentTaskCategory,
  LlmModelDescriptor,
  LlmRouterConfig,
  LlmRouterDecision,
  LlmRouterStatusResponse,
} from '../src/moon/agent-types.ts';

/** Default Claude model of the router (Claude Sonnet 5.5). Opus 5.5 and Haiku 5.5 can be pinned in the panel. */
const SONNET_ID = 'claude-sonnet-5-5';

class AutonomousLlmRouter {
  private config: LlmRouterConfig = {
    mode: 'auto',
    preferLowLatency: false,
    preferLowCost: false,
    timeoutMs: 60000,
    maxRetries: 2,
  };

  private stats = {
    totalRequests: 0,
    totalFallbacks: 0,
    totalEstimatedTokens: 0,
    totalEstimatedCostUsd: 0,
    lastDecision: null as LlmRouterDecision | null,
  };

  private degradedUntil = new Map<string, number>();

  public getConfig(): LlmRouterConfig {
    return { ...this.config };
  }

  public updateConfig(patch: Partial<LlmRouterConfig>): LlmRouterConfig {
    this.config = {
      ...this.config,
      ...patch,
      timeoutMs: Math.max(2000, Math.min(180000, Number(patch.timeoutMs ?? this.config.timeoutMs))),
      maxRetries: Math.max(0, Math.min(3, Number(patch.maxRetries ?? this.config.maxRetries))),
    };
    return this.getConfig();
  }

  public discoverModels(): LlmModelDescriptor[] {
    const now = Date.now();
    const hasOpenAi = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 8);
    const hasAnthropic = Boolean(
      process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 8,
    );
    const hasOpenRouter = Boolean(
      process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 8,
    );
    const hasOllama = Boolean(process.env.OLLAMA_MODEL || process.env.OLLAMA_HOST);

    const isHealthy = (id: string, configured: boolean) =>
      configured && (this.degradedUntil.get(id) ?? 0) < now;

    const catalog: LlmModelDescriptor[] = [
      {
        id: 'gpt-4o',
        provider: 'openai',
        displayName: 'OpenAI GPT-4o',
        configured: hasOpenAi,
        available: isHealthy('gpt-4o', hasOpenAi),
        reasoningScore: 95,
        toolCallingScore: 97,
        structuredOutputSupport: true,
        multimodalSupport: true,
        contextWindowTokens: 128_000,
        latencyClass: 'balanced',
        costPer1kTokensUsd: 0.005,
        statusNote: hasOpenAi
          ? 'Configured via OPENAI_API_KEY'
          : 'Set OPENAI_API_KEY in .env.local to enable OpenAI inference',
      },
      {
        id: 'gpt-4o-mini',
        provider: 'openai',
        displayName: 'OpenAI GPT-4o Mini',
        configured: hasOpenAi,
        available: isHealthy('gpt-4o-mini', hasOpenAi),
        reasoningScore: 86,
        toolCallingScore: 91,
        structuredOutputSupport: true,
        multimodalSupport: true,
        contextWindowTokens: 128_000,
        latencyClass: 'fast',
        costPer1kTokensUsd: 0.00015,
        statusNote: hasOpenAi
          ? 'Configured via OPENAI_API_KEY (Economical low-latency tier)'
          : 'Set OPENAI_API_KEY in .env.local to enable OpenAI inference',
      },
      {
        id: SONNET_ID,
        provider: 'anthropic',
        displayName: 'Anthropic Claude Sonnet 5.5',
        configured: hasAnthropic,
        available: isHealthy(SONNET_ID, hasAnthropic),
        reasoningScore: 98,
        toolCallingScore: 98,
        structuredOutputSupport: true,
        multimodalSupport: true,
        contextWindowTokens: 200_000,
        latencyClass: 'balanced',
        costPer1kTokensUsd: 0.003,
        statusNote: hasAnthropic
          ? 'Configured via ANTHROPIC_API_KEY (shared with Meridian). Default model.'
          : 'Set ANTHROPIC_API_KEY in .env.local (or save it in Meridian Settings) to enable Claude',
      },
      {
        id: 'claude-opus-5-5',
        provider: 'anthropic',
        displayName: 'Anthropic Claude Opus 5.5',
        configured: hasAnthropic,
        available: isHealthy('claude-opus-5-5', hasAnthropic),
        reasoningScore: 99,
        toolCallingScore: 98,
        structuredOutputSupport: true,
        multimodalSupport: true,
        contextWindowTokens: 200_000,
        latencyClass: 'deep',
        costPer1kTokensUsd: 0.015,
        statusNote: hasAnthropic
          ? 'Configured via ANTHROPIC_API_KEY (deepest reasoning, slower and costlier: pick it manually)'
          : 'Set ANTHROPIC_API_KEY in .env.local (or save it in Meridian Settings) to enable Claude',
      },
      {
        id: 'claude-haiku-5-5',
        provider: 'anthropic',
        displayName: 'Anthropic Claude Haiku 5.5',
        configured: hasAnthropic,
        available: isHealthy('claude-haiku-5-5', hasAnthropic),
        reasoningScore: 90,
        toolCallingScore: 92,
        structuredOutputSupport: true,
        multimodalSupport: true,
        contextWindowTokens: 200_000,
        latencyClass: 'fast',
        costPer1kTokensUsd: 0.001,
        statusNote: hasAnthropic
          ? 'Configured via ANTHROPIC_API_KEY (fast and economical)'
          : 'Set ANTHROPIC_API_KEY in .env.local (or save it in Meridian Settings) to enable Claude',
      },
      {
        id: 'openrouter-auto',
        provider: 'openrouter',
        displayName: 'OpenRouter Auto-Model Gateway',
        configured: hasOpenRouter,
        available: isHealthy('openrouter-auto', hasOpenRouter),
        reasoningScore: 93,
        toolCallingScore: 92,
        structuredOutputSupport: true,
        multimodalSupport: true,
        contextWindowTokens: 128_000,
        latencyClass: 'balanced',
        costPer1kTokensUsd: 0.002,
        statusNote: hasOpenRouter
          ? 'Configured via OPENROUTER_API_KEY'
          : 'Set OPENROUTER_API_KEY in .env.local to enable OpenRouter',
      },
      {
        id: process.env.OLLAMA_MODEL || 'llama3.1:8b',
        provider: 'ollama',
        displayName: `Local Ollama (${process.env.OLLAMA_MODEL || 'llama3.1:8b'})`,
        configured: hasOllama,
        available: isHealthy(process.env.OLLAMA_MODEL || 'llama3.1:8b', hasOllama),
        reasoningScore: 82,
        toolCallingScore: 84,
        structuredOutputSupport: true,
        multimodalSupport: false,
        contextWindowTokens: 64_000,
        latencyClass: 'fast',
        costPer1kTokensUsd: 0.0,
        statusNote: hasOllama
          ? 'Configured via OLLAMA_HOST / OLLAMA_MODEL'
          : 'Set OLLAMA_HOST in .env.local to enable local Ollama LLM',
      },
      {
        id: 'terratwin-scientific-nlu-v2',
        provider: 'terratwin_scientific_engine',
        displayName: 'TERRATWIN Deterministic Aerospace NLU & Tool Engine v2',
        configured: true,
        available: true,
        reasoningScore: 92,
        toolCallingScore: 100,
        structuredOutputSupport: true,
        multimodalSupport: false,
        contextWindowTokens: 256_000,
        latencyClass: 'fast',
        costPer1kTokensUsd: 0.0,
        statusNote: 'Built-in zero-latency planetary NLU & deterministic tool orchestrator (Always active)',
      },
    ];

    return catalog;
  }

  public scoreModelForTask(model: LlmModelDescriptor, task: AgentTaskCategory): number {
    if (!model.available) return -1;

    let score = 0;
    if (task === 'mission_reasoning') {
      score = model.reasoningScore * 0.6 + model.toolCallingScore * 0.3 + (model.structuredOutputSupport ? 10 : 0);
    } else if (task === 'tool_orchestration') {
      score = model.toolCallingScore * 0.65 + model.reasoningScore * 0.25 + (model.structuredOutputSupport ? 10 : 0);
    } else if (task === 'visual_interpretation') {
      if (!model.multimodalSupport && model.provider !== 'terratwin_scientific_engine') return -1;
      score = model.reasoningScore * 0.55 + (model.multimodalSupport ? 35 : 5);
    } else {
      // conversational_followup
      score =
        model.reasoningScore * 0.4 +
        model.toolCallingScore * 0.3 +
        (model.latencyClass === 'fast' ? 25 : 10);
    }

    if (this.config.preferLowLatency && model.latencyClass === 'fast') {
      score += 12;
    }
    if (this.config.preferLowCost) {
      score += Math.max(0, 10 - model.costPer1kTokensUsd * 2000);
    }

    // Prefer external cloud LLM slightly when configured, while keeping built-in engine at a high baseline
    if (model.provider !== 'terratwin_scientific_engine' && model.configured) {
      score += 6;
    }

    // Claude Sonnet 5.5 is the automatic Claude choice. Opus (slower, costlier) is manual-only, and Haiku
    // is picked automatically only when low latency or low cost is preferred.
    if (model.id === 'claude-opus-5-5') score -= 40;
    if (model.id === 'claude-haiku-5-5' && !this.config.preferLowLatency && !this.config.preferLowCost) score -= 40;

    return Math.round(score * 10) / 10;
  }

  public selectCandidates(task: AgentTaskCategory): LlmModelDescriptor[] {
    const models = this.discoverModels();

    if (this.config.mode === 'pinned' && this.config.pinnedModelId) {
      const pinned = models.find((m) => m.id === this.config.pinnedModelId && m.available);
      if (pinned) {
        const rest = models
          .filter((m) => m.id !== pinned.id && m.available)
          .sort((a, b) => this.scoreModelForTask(b, task) - this.scoreModelForTask(a, task));
        return [pinned, ...rest];
      }
    }

    return models
      .filter((m) => m.available)
      .sort((a, b) => this.scoreModelForTask(b, task) - this.scoreModelForTask(a, task));
  }

  public getStatus(): LlmRouterStatusResponse {
    return {
      config: this.getConfig(),
      models: this.discoverModels(),
      stats: { ...this.stats },
    };
  }

  /**
   * Optional LLM synthesis / refinement call with automatic provider fallback.
   * Note: All scientific measurements, landing site evaluations, and A* routes are ALWAYS
   * computed by TERRATWIN's deterministic engines first; the LLM is used only for natural-language
   * intent refinement or narrative explanation, with a guaranteed deterministic fallback.
   */
  public async executeNarrativeOrIntentTask(options: {
    taskCategory: AgentTaskCategory;
    systemPrompt: string;
    userPrompt: string;
    deterministicFallback: () => string;
  }): Promise<{ text: string; decision: LlmRouterDecision }> {
    const startMs = performance.now();
    const candidates = this.selectCandidates(options.taskCategory);
    const fallbackChain: string[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      fallbackChain.push(candidate.id);

      if (candidate.provider === 'terratwin_scientific_engine') {
        const text = options.deterministicFallback();
        const latencyMs = Math.max(2, Math.round(performance.now() - startMs));
        const estTokens = Math.ceil((options.systemPrompt.length + options.userPrompt.length + text.length) / 4);
        const externalConfigured = candidates.some(
          (c) => c.provider !== 'terratwin_scientific_engine' && c.configured,
        );
        const decision: LlmRouterDecision = {
          selectedModelId: candidate.id,
          provider: candidate.provider,
          displayName: candidate.displayName,
          taskCategory: options.taskCategory,
          selectionReason: externalConfigured
            ? 'Fallback to built-in deterministic aerospace NLU & tool engine after upstream provider error'
            : 'Auto-selected built-in deterministic aerospace NLU & tool engine (100% tool reliability, 0ms cloud overhead)',
          fallbackUsed: i > 0,
          fallbackChain,
          latencyMs,
          estimatedTokens: estTokens,
          estimatedCostUsd: 0,
        };
        this.recordStats(decision);
        return { text, decision };
      }

      // Attempt external provider call with timeout & retry
      try {
        const text = await this.callWithRetry(candidate, options.systemPrompt, options.userPrompt);
        if (text && text.trim().length > 15) {
          const latencyMs = Math.max(5, Math.round(performance.now() - startMs));
          const estTokens = Math.ceil(
            (options.systemPrompt.length + options.userPrompt.length + text.length) / 4,
          );
          const estCost = Number(((estTokens / 1000) * candidate.costPer1kTokensUsd).toFixed(6));
          const decision: LlmRouterDecision = {
            selectedModelId: candidate.id,
            provider: candidate.provider,
            displayName: candidate.displayName,
            taskCategory: options.taskCategory,
            selectionReason: `Highest-ranked available model for ${options.taskCategory} (reasoning=${candidate.reasoningScore}, tool=${candidate.toolCallingScore})`,
            fallbackUsed: i > 0,
            fallbackChain,
            latencyMs,
            estimatedTokens: estTokens,
            estimatedCostUsd: estCost,
          };
          this.recordStats(decision);
          return { text: text.trim(), decision };
        }
      } catch {
        // Mark provider model degraded for 60s and continue fallback chain
        this.degradedUntil.set(candidate.id, Date.now() + 60_000);
        this.stats.totalFallbacks += 1;
      }
    }

    const fallbackText = options.deterministicFallback();
    const latencyMs = Math.max(2, Math.round(performance.now() - startMs));
    const decision: LlmRouterDecision = {
      selectedModelId: 'terratwin-scientific-nlu-v2',
      provider: 'terratwin_scientific_engine',
      displayName: 'TERRATWIN Deterministic Aerospace NLU & Tool Engine v2',
      taskCategory: options.taskCategory,
      selectionReason: 'Guaranteed deterministic fallback',
      fallbackUsed: fallbackChain.length > 1,
      fallbackChain,
      latencyMs,
      estimatedTokens: 250,
      estimatedCostUsd: 0,
    };
    this.recordStats(decision);
    return { text: fallbackText, decision };
  }

  private recordStats(decision: LlmRouterDecision) {
    this.stats.totalRequests += 1;
    if (decision.fallbackUsed) this.stats.totalFallbacks += 1;
    this.stats.totalEstimatedTokens += decision.estimatedTokens;
    this.stats.totalEstimatedCostUsd = Number(
      (this.stats.totalEstimatedCostUsd + decision.estimatedCostUsd).toFixed(6),
    );
    this.stats.lastDecision = decision;
  }

  /** Timeouts, rate limits (429) and temporary server errors (5xx, 529) are retried before falling back. */
  private async callWithRetry(model: LlmModelDescriptor, systemPrompt: string, userPrompt: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.callExternalProvider(model, systemPrompt, userPrompt);
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : '';
        const status = Number(/HTTP (\d{3})/.exec(msg)?.[1] ?? 0);
        const transient = status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
        if (!transient || attempt === this.config.maxRetries) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async callExternalProvider(
    model: LlmModelDescriptor,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      if (model.provider === 'openai') {
        const key = process.env.OPENAI_API_KEY?.trim();
        if (!key) throw new Error('Missing OPENAI_API_KEY');
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: model.id,
            temperature: 0.2,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
        const data: any = await res.json();
        return data?.choices?.[0]?.message?.content || '';
      }

      if (model.provider === 'gemini') {
        const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
        if (!key) throw new Error('Missing GEMINI_API_KEY');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.2 },
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
        const data: any = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }

      if (model.provider === 'anthropic') {
        const key = process.env.ANTHROPIC_API_KEY?.trim();
        if (!key) throw new Error('Missing ANTHROPIC_API_KEY');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model.id,
            max_tokens: 3000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
        const data: any = await res.json();
        return data?.content?.[0]?.text || '';
      }

      if (model.provider === 'openrouter') {
        const key = process.env.OPENROUTER_API_KEY?.trim();
        if (!key) throw new Error('Missing OPENROUTER_API_KEY');
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: 'openrouter/auto',
            temperature: 0.2,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
        const data: any = await res.json();
        return data?.choices?.[0]?.message?.content || '';
      }

      if (model.provider === 'ollama') {
        const host = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
        const res = await fetch(`${host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model.id,
            stream: false,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
        const data: any = await res.json();
        return data?.message?.content || '';
      }

      throw new Error(`Unsupported provider ${model.provider}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const llmRouter = new AutonomousLlmRouter();
