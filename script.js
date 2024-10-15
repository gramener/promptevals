import { SSE } from "https://cdn.jsdelivr.net/npm/sse.js@2";
import { parse } from "https://cdn.jsdelivr.net/npm/partial-json@0.1.7/+esm";
import { html, render } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { num2, pc1 } from "https://cdn.jsdelivr.net/npm/@gramex/ui/dist/format.js";
import { AsyncQueue } from "https://cdn.jsdelivr.net/npm/@ai-zen/async-queue@1.3.1/+esm";
import { sumBy, sortBy } from "https://cdn.jsdelivr.net/npm/lodash-es@4/+esm";
import { diffWords } from "https://cdn.jsdelivr.net/npm/diff@7/+esm";

const $prompt = document.querySelector("#prompt");
const $promptModel = document.querySelector("#prompt-model");
const $outputModel = document.querySelector("#output-model");
const $generatePrompt = document.querySelector("#generate-prompt");
const $generateOutput = document.querySelector("#generate-output");
const $generateOutputCancel = document.querySelector("#generate-output-cancel");
const $outputTable = document.querySelector("#output-table");
const $score = document.querySelector("#score");
const $outputProgress = document.querySelector("#output-progress");
const $data = document.querySelector("#data");
const $embeddingSimilarity = document.querySelector("#embedding-similarity");
const $evaluationModel = document.querySelector("#evaluation-model");
const $criteria = document.querySelector("#criteria");
const $evaluatePrompt = document.querySelector("#evaluate-prompt");
const $evaluateCancel = document.querySelector("#evaluate-cancel");
const $revisePrompt = document.querySelector("#revise-prompt");
const $revisionModel = document.querySelector("#revision-model");
const $revisedPrompt = document.querySelector("#revised-prompt");
const $applyPrompt = document.querySelector("#apply-prompt");
const $experiments = document.querySelector("#experiments");
const $itemModal = document.querySelector("#item-modal");
const modal = new bootstrap.Modal($itemModal);

const shuffler = d3.shuffler(d3.randomLcg(12345));

const experiments = {};
let sample;
let data;
let criteria = [];
let revisedPrompt;

const { token } = await fetch("https://llmfoundry.straive.com/token", { credentials: "include" }).then((r) => r.json());
if (!token) {
  const url = "https://llmfoundry.straive.com/login?" + new URLSearchParams({ next: location.href });
  render(html`<a class="btn btn-primary" href="${url}">Log into LLM Foundry</a></p>`, document.querySelector("#login"));
}

const llmStream = (body) => {
  const queue = new AsyncQueue();
  Object.assign(body, { stream: true, stream_options: { include_usage: true } });
  const source = new SSE("https://llmfoundry.straive.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}:promptevals` },
    payload: JSON.stringify(body),
    start: false,
  });
  let content = "";
  let usage = null;
  source.addEventListener("message", (event) => {
    if (event.data == "[DONE]") return queue.done();
    const message = JSON.parse(event.data);
    const content_delta = message.choices?.[0]?.delta?.content;
    if (content_delta) content += content_delta;
    if (message.usage) usage = message.usage;
    queue.push({ content, usage });
  });
  source.stream();
  return queue;
};

document.querySelector("#demos").addEventListener("click", async (event) => {
  const $demo = event.target.closest(".demo");
  if ($demo) {
    event.preventDefault();
    $data.value = "Loading...";
    data = await d3.csv($demo.href);
    $data.value = data.map((row) => data.columns.map((c) => row[c]).join("\t")).join("\n");
    $data.dispatchEvent(new Event("input", { bubbles: true }));
  }
});

$generatePrompt.addEventListener("click", async () => {
  const parseData = (rawData) => {
    const parsedData = d3.tsvParse(rawData);
    const columns = parsedData.columns;
    return parsedData.map((row) => ({
      input: row[columns[0]],
      output: row[columns[1]],
    }));
  };

  try {
    data = parseData(document.querySelector("#data").value);
    sample = shuffler(data).slice(0, document.querySelector("#sample").value);
    $generatePrompt.querySelector(".loading").classList.remove("d-none");
    $generatePrompt.disabled = true;
    for await (const { content, usage } of llmStream({
      model: $promptModel.value,
      messages: generatePromptMessages(sample),
    })) {
      const promptMatch = content.match(/<PROMPT>([\s\S]*?)<\/PROMPT>/);
      $prompt.value = promptMatch ? promptMatch[1].trim() : content;
    }
    $generatePrompt.querySelector(".loading").classList.add("d-none");
    $generatePrompt.disabled = false;
  } catch (error) {
    console.error("Error generating prompt:", error);
  }
});

function generatePromptMessages(sample) {
  return [
    {
      role: "system",
      content: `You'll get a set of <INPUT>...</INPUT> and <OUTPUT>...</OUTPUT> pairs.
Generate a detailed LLM system prompt that will generate the output possible when given only the input.
Mention the word count and style of writing.
Include ONE simplified example.
Write the prompt inside a <PROMPT>...</PROMPT> tag.`,
    },
    {
      role: "user",
      content: sample.map((pair) => `<INPUT>${pair.input}</INPUT>\n<OUTPUT>${pair.output}</OUTPUT>`).join("\n"),
    },
  ];
}

function drawTable() {
  if (!data || !data.length) return render(html`<tbody></tbody>`, $outputTable);
  const firstRow = data[0];
  const minEmbeddingSimilarity = $embeddingSimilarity.value;
  render(
    html`<thead>
        <tr>
          <th>Input</th>
          <th>Expected</th>
          <th>Generated</th>
          ${firstRow.embeddingSimilarity ? html`<th>Embedding</th>` : ""}
          ${criteria.length && firstRow[criteria[0]] ? html`<th>Score</th>` : null}
          ${criteria.map((c) => (firstRow[c] ? html`<th title>${c}</th>` : null))}
        </tr>
      </thead>
      <tbody>
        ${data.map(
          (row, index) => html`
            <tr data-index="${index}">
              <td>${row.input}</td>
              <td>${row.output}</td>
              <td>
                ${row.generated
                  ? html`<span class="output-text">${row.generated}</span>`
                  : generating
                  ? html`
                      <div class="spinner-border spinner-border-sm text-primary d-none" role="status">
                        <span class="visually-hidden">Loading...</span>
                      </div>
                    `
                  : ""}
              </td>
              ${!firstRow.embeddingSimilarity
                ? null
                : !row.embeddingSimilarity
                ? html`<td></td>`
                : html`<td
                    class="text-end ${row.embeddingSimilarity >= minEmbeddingSimilarity
                      ? "text-bg-success"
                      : "text-bg-danger"}"
                  >
                    ${pc1(row.embeddingSimilarity)}
                  </td>`}
              ${criteria.length && firstRow[criteria[0]]
                ? html`<td class="text-end">${num2(getScore(row))}</td>`
                : null}
              ${criteria.map((c) =>
                row[c]
                  ? html`<td class="text-center" title="${row[c]?.explanation}">${row[c]?.success ? "✅" : "❌"}</td>`
                  : null
              )}
            </tr>
          `
        )}
      </tbody>`,
    $outputTable
  );
  const score = sumBy(data, getScore);
  if (score) render(html`<div class="text-end">Score: ${num2(score)}</div>`, $score);
  $score.classList.toggle("d-none", !score);
}

let generating, generateCancel;

$generateOutput.addEventListener("click", async () => {
  if (!data || !$prompt.value) {
    alert("Please generate a prompt first.");
    return;
  }

  // Hide loading indicator and disable generate, enable cancel, buttons.
  $generateOutput.querySelector(".loading").classList.remove("d-none");
  $generateOutputCancel.querySelector(".loading").classList.add("d-none");
  $generateOutput.disabled = true;
  $generateOutputCancel.disabled = false;
  generating = true;
  generateCancel = false;

  // Generate outputs for each row
  for (const [index, row] of data.entries()) {
    drawTable();
    $outputProgress.style.width = `${(index / data.length) * 100}%`;
    if (generateCancel) break;
    try {
      for await (const { content } of llmStream({
        model: $outputModel.value,
        messages: [
          { role: "system", content: $prompt.value },
          { role: "user", content: row.input },
        ],
      })) {
        if (generateCancel) break;
        row.generated = content;
        drawTable();
      }
    } catch (error) {
      console.error("Error generating output:", error);
      row.generated = `Error generating output: ${error.message}`;
    }
    $outputProgress.style.width = `${((index + 1) / data.length) * 100}%`;
  }

  // Hide loading indicator and enable generate, disable cancel, buttons.
  $generateOutput.querySelector(".loading").classList.add("d-none");
  $generateOutputCancel.querySelector(".loading").classList.add("d-none");
  $generateOutput.disabled = false;
  $generateOutputCancel.disabled = true;
  generating = false;
  drawTable();
});

// When cancel is clicked, trigger cancellation via cancel=true.
// Show loading indicator to suggest cancellation is in progress and disable the button.
$generateOutputCancel.addEventListener("click", () => {
  generateCancel = true;
  $generateOutputCancel.querySelector(".loading").classList.remove("d-none");
  $generateOutputCancel.disabled = true;
});

$data.addEventListener("input", (event) => localStorage.setItem("promptEvalsInput", event.target.value));
$criteria.addEventListener("input", (event) => {
  localStorage.setItem("promptEvalsCriteria", event.target.value);
  criteria = $criteria.value
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);
});

$outputTable.addEventListener("click", (event) => {
  const row = event.target.closest("tbody tr");
  if (!row) return;
  const rowData = data[+row.dataset.index];
  const columns = Object.keys(rowData);
  const modalContent = html`
    <table class="table">
      <thead>
        <tr>
          <th>Column</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        ${columns.map(
          (column) => html`
            <tr>
              <td>${column}</td>
              <td>
                ${typeof rowData[column] === "object"
                  ? html`${rowData[column]?.success ? "✅" : "❌"} ${rowData[column]?.explanation}`
                  : rowData[column]}
              </td>
            </tr>
          `
        )}
      </tbody>
    </table>
  `;
  render(modalContent, $itemModal.querySelector(".modal-body"));
  $itemModal.querySelector(".modal-title").textContent = `Item: ${+row.dataset.index + 1}`;
  $itemModal.dataset.index = row.dataset.index;
  modal.show();
});

document.addEventListener("keydown", (event) => {
  if (!$itemModal.classList.contains("show")) return;
  const index =
    event.key === "ArrowUp" || event.key === "ArrowLeft"
      ? (+$itemModal.dataset.index - 1 + data.length) % data.length
      : event.key === "ArrowDown" || event.key === "ArrowRight"
      ? (+$itemModal.dataset.index + 1) % data.length
      : null;
  if (index !== null) $outputTable.querySelector(`tbody tr[data-index="${index}"]`).click();
});

let evaluating, evaluateCancel;

$evaluatePrompt.addEventListener("click", async () => {
  if (!data || data.length === 0 || !data[0].generated) {
    alert("Please generate outputs first.");
    return;
  }

  // Hide loading indicator and disable generate, enable cancel, buttons.
  $evaluatePrompt.querySelector(".loading").classList.remove("d-none");
  $evaluateCancel.querySelector(".loading").classList.add("d-none");
  $evaluatePrompt.disabled = true;
  $evaluateCancel.disabled = false;
  evaluating = true;
  evaluateCancel = false;

  // Evaluate embedding similarity
  const response = await fetch("https://llmfoundry.straive.com/similarity", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}:promptevals` },
    body: JSON.stringify({
      docs: data.map((d) => d.generated),
      topics: data.map((d) => d.output),
      model: "text-embedding-3-small",
    }),
  });
  const result = await response.json();
  // Set the embedding similarity based on the diagonal of the result
  result.similarity.forEach((row, index) => (data[index].embeddingSimilarity = row[index]));
  drawTable();

  // Evaluate criteria
  if (criteria.length === 0) return;
  const response_format = {
    type: "json_schema",
    json_schema: {
      name: "criteria_evaluation",
      schema: {
        type: "object",
        properties: Object.fromEntries(
          criteria.map((term) => [
            term,
            {
              type: "object",
              properties: { explanation: { type: "string" }, success: { type: "boolean" } },
              required: ["explanation", "success"],
              additionalProperties: false,
            },
          ])
        ),
        required: criteria,
        additionalProperties: false,
      },
    },
  };
  for (const row of data) {
    if (evaluateCancel) break;
    for await (const { content, usage } of llmStream({
      model: $evaluationModel.value,
      messages: [
        { role: "system", content: `Given the <EXPECTED> text and the <GENERATED> output, evaluate the criteria.` },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `<EXPECTED>\n${row.output}\n</EXPECTED>\n\n<GENERATED>\n${row.generated}\n</GENERATED>`,
            },
          ],
        },
      ],
      response_format,
    })) {
      if (evaluateCancel) break;
      if (!content) continue;
      Object.assign(row, parse(content));
      drawTable();
    }
  }

  // Save result
  experiments[$prompt.value] = {
    score: sumBy(data, getScore),
    data: JSON.parse(JSON.stringify(data)),
    criteria: JSON.parse(JSON.stringify(criteria)),
  };
  drawExperiments();

  // Hide loading indicator and enable generate, disable cancel, buttons.
  $evaluatePrompt.querySelector(".loading").classList.add("d-none");
  $evaluateCancel.querySelector(".loading").classList.add("d-none");
  $evaluatePrompt.disabled = false;
  $evaluateCancel.disabled = true;
  evaluating = false;
  drawTable();
});

function drawExperiments() {
  render(
    html`
      <table class="table">
        <thead>
          <tr>
            <th class="text-end">Score</th>
            <th>Prompt</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(experiments).map(([prompt, { score, criteria, data }]) => {
            return html`<tr>
              <td class="text-end">${num2(score)}</td>
              <td>
                <p style="white-space: pre-wrap">${prompt}</p>
                <p><strong>Criteria:</strong></p>
                <div class="table-responsive">
                  <table class="table table-sm">
                    <tbody>
                      ${criteria.map(
                        (c) => html`
                          <tr>
                            <th scope="row">${c}</th>
                            <td>
                              ${data.map(
                                (d) => html`<span title="${d[c]?.explanation}">${d[c]?.success ? "✅" : "❌"}</span>`
                              )}
                            </td>
                          </tr>
                        `
                      )}
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
    `,
    $experiments
  );
}

// When cancel is clicked, trigger cancellation via cancel=true.
// Show loading indicator to suggest cancellation is in progress and disable the button.
$evaluateCancel.addEventListener("click", () => {
  evaluateCancel = true;
  $evaluateCancel.querySelector(".loading").classList.remove("d-none");
  $evaluateCancel.disabled = true;
});

$revisePrompt.addEventListener("click", async () => {
  if (!data || data.length === 0 || !data[0].generated || !data[0].embeddingSimilarity) {
    alert("Please generate outputs and evaluate the prompt first.");
    return;
  }

  // Sort a copy of data by score = embeddingSimilarity + sum(criteria[].success)
  const sortedData = sortBy(data, (d) => d.embeddingSimilarity + sumBy(criteria, (term) => (d[term]?.success ? 1 : 0)));
  const examples = sortedData.slice(0, +document.querySelector("#examples").value);
  $revisedPrompt.innerHTML = /* html */ `<div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div>`;
  for await (const { content, usage } of llmStream({
    model: $revisionModel.value,
    messages: [
      ...generatePromptMessages(sample),
      { role: "assistant", content: `<PROMPT>${$prompt.value}</PROMPT>` },
      {
        role: "user",
        content: `Improve this prompt using feedback from these evals and try to improve similarity. Think step by step.

${examples
  .map(
    (d) => `<EVAL>
<INPUT>${d.input}</INPUT>
<EXPECTED>${d.output}</EXPECTED>
<GENERATED>${d.generated}</GENERATED>
<SIMILARITY>${d.embeddingSimilarity}</SIMILARITY>
${criteria
  .map(
    (c) => `<CHECK>
  <CRITERION>${c}</CRITERION>
  <RESULT>${d[c]?.success ? "YES" : "NO"} ${d[c]?.explanation}</RESULT>
</CHECK>`
  )
  .join("\n")}
</EVAL>`
  )
  .join("\n\n")}`,
      },
    ],
  })) {
    const promptMatch = content.match(/<PROMPT>([\s\S]*?)<\/PROMPT>/);
    $revisedPrompt.textContent = promptMatch ? promptMatch[1].trim() : content;
  }
  revisedPrompt = $revisedPrompt.textContent;
  const diffs = diffWords($prompt.value, revisedPrompt);
  $revisedPrompt.innerHTML = diffs
    .map(({ added, removed, value }) => {
      const val = value.replace(
        /[&<>'"]/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#39;",
            '"': "&quot;",
          }[char])
      );
      return added ? `<ins>${val}</ins>` : removed ? `<del>${val}</del>` : val;
    })
    .join("");
});

$applyPrompt.addEventListener("click", () => {
  if (!revisedPrompt) {
    alert("Please revise the prompt first.");
    return;
  }
  $prompt.value = revisedPrompt;
  revisedPrompt = null;
  $prompt.dispatchEvent(new Event("input", { bubbles: true }));
  // Remove everything except input, output from data
  data = data.map((d) => ({ input: d.input, output: d.output }));
  drawTable();
  $generateOutput.scrollIntoView({ behavior: "smooth" });
  $generateOutput.click();
});

$embeddingSimilarity.addEventListener("input", (event) => {
  document.querySelector("#embedding-similarity-value").textContent = `${pc1(event.target.value)}`;
  drawTable();
});

const getScore = (row) => row.embeddingSimilarity + sumBy(criteria, (c) => (row[c]?.success ? 1 : 0));

const savedInput = localStorage.getItem("promptEvalsInput");
if (savedInput) $data.value = savedInput;
$data.dispatchEvent(new Event("input", { bubbles: true }));

const savedCriteria = localStorage.getItem("promptEvalsCriteria");
if (savedCriteria) $criteria.value = savedCriteria;
$criteria.dispatchEvent(new Event("input", { bubbles: true }));

// TODO: Graceful fetch error handling
// TODO: Graceful cancellation / weird data error handling
// TODO: Refactor for readability
