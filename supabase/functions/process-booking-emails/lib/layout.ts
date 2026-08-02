import { escapeHtml } from "./formatters.ts";

interface EmailLayoutOptions {
  eyebrow: string;
  heading: string;
  body: string;
  details?: Array<{
    label: string;
    value: string;
  }>;
  buttonLabel?: string;
  buttonUrl?: string;
}

export function getEmailLayout({
  eyebrow,
  heading,
  body,
  details,
  buttonLabel,
  buttonUrl,
}: EmailLayoutOptions): string {
  const detailRows = details
    ?.filter((detail) => detail.value)
    .map(
      (detail) => `
        <tr>
          <td
            style="
              padding: 10px 0;
              color: #607060;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 13px;
              text-transform: uppercase;
              letter-spacing: 0.12em;
              vertical-align: top;
              width: 130px;
            "
          >
            ${escapeHtml(detail.label)}
          </td>

          <td
            style="
              padding: 10px 0;
              color: #2f392f;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 16px;
              line-height: 1.6;
              vertical-align: top;
            "
          >
            ${escapeHtml(detail.value)}
          </td>
        </tr>
      `,
    )
    .join("");

  const detailsBlock = detailRows
    ? `
      <table
        role="presentation"
        width="100%"
        cellspacing="0"
        cellpadding="0"
        style="
          margin-top: 30px;
          border-top: 1px solid rgba(47, 57, 47, 0.14);
          border-bottom: 1px solid rgba(47, 57, 47, 0.14);
        "
      >
        ${detailRows}
      </table>
    `
    : "";

  const buttonBlock =
    buttonLabel && buttonUrl
      ? `
        <table
          role="presentation"
          cellspacing="0"
          cellpadding="0"
          style="margin-top: 32px;"
        >
          <tr>
            <td
              style="
                border-radius: 999px;
                background: #718971;
              "
            >
              <a
                href="${escapeHtml(buttonUrl)}"
                style="
                  display: inline-block;
                  padding: 14px 24px;
                  color: #f1e8ca;
                  font-family: Arial, Helvetica, sans-serif;
                  font-size: 14px;
                  text-decoration: none;
                  letter-spacing: 0.06em;
                "
              >
                ${escapeHtml(buttonLabel)}
              </a>
            </td>
          </tr>
        </table>
      `
      : "";

  return `
    <!doctype html>

    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
        <title>${escapeHtml(heading)}</title>
      </head>

      <body
        style="
          margin: 0;
          padding: 0;
          background: #edf2ed;
        "
      >
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          style="
            width: 100%;
            background: #edf2ed;
          "
        >
          <tr>
            <td align="center" style="padding: 32px 16px;">
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                style="
                  width: 100%;
                  max-width: 640px;
                  overflow: hidden;
                  border: 1px solid rgba(47, 57, 47, 0.12);
                  border-radius: 28px;
                  background: #f8f5e9;
                "
              >
                <tr>
                  <td style="padding: 46px 42px;">
                    <p
                      style="
                        margin: 0 0 18px;
                        color: #718971;
                        font-family: Arial, Helvetica, sans-serif;
                        font-size: 12px;
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 0.3em;
                      "
                    >
                      ${escapeHtml(eyebrow)}
                    </p>

                    <h1
                      style="
                        margin: 0;
                        color: #2f392f;
                        font-family: Georgia, 'Times New Roman', serif;
                        font-size: 42px;
                        font-weight: 400;
                        line-height: 1.12;
                      "
                    >
                      ${escapeHtml(heading)}
                    </h1>

                    <div
                      style="
                        margin-top: 26px;
                        color: #526052;
                        font-family: Arial, Helvetica, sans-serif;
                        font-size: 17px;
                        line-height: 1.8;
                      "
                    >
                      ${body}
                    </div>

                    ${detailsBlock}
                    ${buttonBlock}
                  </td>
                </tr>

                <tr>
                  <td
                    style="
                      padding: 24px 42px;
                      background: #9ebd9e;
                      color: #f1e8ca;
                      font-family: Arial, Helvetica, sans-serif;
                      font-size: 12px;
                      line-height: 1.6;
                      text-align: center;
                    "
                  >
                    Amanda Beach · Holistic Wellbeing and Events
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}
