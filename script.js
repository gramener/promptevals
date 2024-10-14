import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import { html, render } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const $generatePrompt = document.querySelector("#generate-prompt");
const $generateOutput = document.querySelector("#generate-output");
const $outputTable = document.querySelector("#output-table");

const shuffler = d3.shuffler(d3.randomLcg(12345));
const marked = new Marked();
let data;


const llm = async ({ system, user, model }) => {
  const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }).then((r) => r.json());
  return response.choices?.[0]?.message?.content || response.error?.message;
};

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
    const sample = shuffler(data).slice(0, document.querySelector("#sample").value);
    const formattedPairs = sample.map((pair) => `INPUT: ${pair.input}\nOUTPUT: ${pair.output}\n`).join("\n");

    $generatePrompt.querySelector(".loading").classList.remove("d-none");
    $generatePrompt.disabled = true;
    const generatedPrompt = await llm({
      system:
        "Write a detailed bulleted prompt that will generate the output as closely as possible when below given only the input. Write ONLY the prompt.",
      user: formattedPairs,
      model: "gpt-4o-mini",
    });
    $generatePrompt.querySelector(".loading").classList.add("d-none");
    $generatePrompt.disabled = false;

    document.querySelector("#prompt").value = generatedPrompt;
  } catch (error) {
    console.error("Error generating prompt:", error);
  }
});

$generateOutput.addEventListener("click", async () => {
  const prompt = document.querySelector("#prompt").value;
  const model = document.querySelector("#output-model").value;
  $outputTable.innerHTML = /* html */ `
    <thead>
      <tr>
        <th>Input</th>
        <th>Expected</th>
        <th>Generated</th>
      </tr>
    </thead>
    <tbody>
      ${data
        .map(
          (row) => /* html */ `
          <tr>
            <td>${row.input}</td>
            <td>${row.output}</td>
            <td class="generated-output">
              <div class="spinner-border spinner-border-sm text-primary d-none" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
              <span class="output-text"></span>
            </td>
          </tr>
        `
        )
        .join("")}
    </tbody>`;

  // Generate outputs for each row
  const rows = $outputTable.querySelectorAll("tbody tr");
  for (const row of rows) {
    const input = row.cells[0].textContent;
    const outputCell = row.cells[2];
    const spinner = outputCell.querySelector(".spinner-border");
    const outputText = outputCell.querySelector(".output-text");

    spinner.classList.remove("d-none");
    try {
      const generatedOutput = await llm({
        system: prompt,
        user: input,
        model: model,
      });
      outputText.innerHTML = marked.parse(generatedOutput);
    } catch (error) {
      console.error("Error generating output:", error);
      outputText.textContent = "Error generating output";
    } finally {
      spinner.classList.add("d-none");
    }
  }
});

document.querySelector("#data").addEventListener("input", (event) => {
  localStorage.setItem("promptEvalsInput", event.target.value);
});

const savedInput = localStorage.getItem("promptEvalsInput");
if (savedInput) document.querySelector("#data").value = savedInput;
