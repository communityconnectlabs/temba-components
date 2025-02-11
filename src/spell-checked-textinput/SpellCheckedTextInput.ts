import { css, html, render, TemplateResult } from 'lit';
import { property, state } from 'lit/decorators';
import { ifDefined } from 'lit-html/directives/if-defined';
import { styleMap } from 'lit-html/directives/style-map';
import { FormElement } from '../FormElement';
import { Modax } from '../dialog/Modax';
import { sanitize } from '../textinput/helpers';
import { CharCount } from '../charcount/CharCount';
import { CustomEventType } from '../interfaces';

interface SpellCheckerResult {
  from: number;
  to: number;
  message: string;
  suggestions: string[];
}

interface SpellCheckerResultPiece {
  text: string;
  result?: SpellCheckerResult;
}

type SpellCheckerFunc = (
  text: string,
  lang: string
) => Promise<SpellCheckerResult[]>;

export class SpellCheckedTextInput extends FormElement {
  static get styles() {
    return css`
      .input-container {
        position: relative;
        border-radius: var(--curvature-widget);
        cursor: text;
        background: var(--color-widget-bg);
        border: 1px solid var(--color-widget-border);
        transition: all ease-in-out 200ms;
        display: flex;
        flex-direction: row;
        align-items: stretch;

        box-shadow: var(--widget-box-shadow);

        caret-color: var(--input-caret);
      }

      .clear-icon {
        --icon-color: var(--color-text-dark-secondary);
        cursor: pointer;
        margin: auto;
        padding-right: 10px;
        line-height: 1;
      }

      .clear-icon:hover {
        --icon-color: var(--color-text-dark);
      }

      .hidden {
        visibility: hidden;
        position: absolute;
      }

      .input-container:focus-within {
        border-color: var(--color-focus);
        background: var(--color-widget-bg-focused);
        box-shadow: var(--widget-box-shadow-focused);
      }

      .input-container:hover {
        background: var(--color-widget-bg-focused);
      }

      .textinput {
        border: none;
        flex: 1;
        background: none;
        color: var(--color-widget-text);
        font-family: var(--font-family);
        font-size: var(--temba-textinput-font-size);
        line-height: normal;
        cursor: text;
        resize: none;
        font-weight: 300;
        width: calc(100% - (var(--temba-textinput-padding) * 2));
        margin: var(--temba-textinput-padding);
        padding: 0;
        // make it behave like a normal input
        display: inline-block;
        white-space: nowrap;
        overflow: hidden;
      }

      .textinput:focus {
        outline: none;
        box-shadow: none;
        cursor: text;
      }

      .textinput:empty:before {
        content: attr(placeholder);
        color: var(--color-placeholder);
        font-weight: 300;
      }

      .textarea {
        overflow-wrap: break-word;
        height: var(--textarea-height);
        max-height: var(--textarea-height, 30px);
        min-height: 30px;
        white-space: unset;
      }

      .grow-wrap {
        display: flex;
        align-items: stretch;
        width: 100%;
      }

      .grow-wrap .textarea {
        display: unset;
        overflow: unset;
        max-height: unset;
      }

      .spell-correction {
        cursor: text;
        display: inline;
        text-decoration: var(--color-error) wavy underline;
      }

      .grow-wrap > div {
        border: 0px solid green;
        flex: 1;
        background: none;
        color: var(--color-widget-text);
        font-family: var(--font-family);
        font-size: var(--temba-textinput-font-size);
        line-height: normal;
        cursor: text;
        resize: none;
        font-weight: 300;
      }
    `;
  }

  private tooltipCss = css`
    #spell-checker-tooltip {
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: fixed;
      min-width: 120px;
      max-width: 200px;
      cursor: default;

      padding: 6px;
      color: var(--color-widget-text);
      background: var(--color-widget-bg);
      border: 1px solid var(--color-widget-border);
      border-radius: var(--curvature-widget);
      box-shadow: var(--widget-box-shadow);
      z-index: 10000;
    }

    #spell-checker-tooltip::after {
      content: '';
      position: absolute;
      width: calc(100% + 16px);
      height: calc(100% + 16px);
      top: -8px;
      left: -8px;
      z-index: -1;
      opacity: 0;
    }

    #spell-checker-tooltip .suggestions {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 5px;
    }

    #spell-checker-tooltip .suggestion {
      cursor: pointer;
      text-decoration: var(--color-link-primary) underline;
    }

    #spell-checker-tooltip .suggestion:hover {
      font-weight: bold;
    }

    #spell-checker-tooltip .tail {
      position: absolute;
      bottom: -4px;
      left: 50%;
      transform: translateX(-50%) rotate(-45deg);
      width: 5px;
      height: 5px;
      border-left: 1px solid var(--color-widget-border);
      border-bottom: 1px solid var(--color-widget-border);
      background: var(--color-widget-bg);
    }

    .right .tail {
      bottom: unset;
      left: -4px;
      top: 50%;
      transform: translateY(-50%) rotate(45deg);
    }

    .left .tail {
      bottom: unset;
      left: unset;
      right: -4px;
      top: 50%;
      transform: translateY(-50%) rotate(-135deg);
    }

    .bottom .tail {
      bottom: unset;
      top: -4px;
      transform: translateX(-50%) rotate(135deg);
    }
  `;

  @property({ type: Boolean })
  textarea: boolean;

  @property({ type: String })
  placeholder = '';

  @property({ type: String })
  value = '';

  @property({ type: String })
  name = '';

  @property({ type: Number })
  maxlength: number;

  @property({ type: Object })
  inputElement: HTMLInputElement;

  @property({ type: Boolean })
  clearable: boolean;

  @property({ type: Boolean })
  gsm: boolean;

  @property({ type: String })
  counter: string;

  // if we are still loading
  @property({ type: Boolean })
  loading = true;

  @property({ type: Boolean })
  submitOnEnter = true;

  @property({ type: Boolean })
  disabled = false;

  @property({ type: Boolean })
  autogrow = false;

  @state()
  private checkingSpelling = false;

  @state()
  private spellCheckResults: TemplateResult;

  counterElement: CharCount = null;
  cursorStart = -1;
  cursorEnd = -1;
  spellCheckerFunc: SpellCheckerFunc;
  inputEventHandlers: any = {};
  spellCheckerTimeout: any;

  public constructor() {
    super();
    if (Object.prototype.hasOwnProperty.call(window, 'spellCheckerFunc')) {
      this.spellCheckerFunc = window['spellCheckerFunc'] as SpellCheckerFunc;
    } else {
      console.error(
        "No 'spellCheckerFunc' of type '(text: string) => Promise<SpellCheckerResult[]>' is found."
      );
    }

    this.inputEventHandlers = {
      input: this.handleInput.bind(this),
      blur: this.handleBlur.bind(this),
      keydown: this.handleKeyDown.bind(this),
      destroyTooltips: this.destroyTooltips.bind(this),
      selectionChange: this.onSelectionChange.bind(this),
      setSelectionRange: this.setSelectionRange.bind(this),
    };
  }

  public firstUpdated(changes: Map<string, any>) {
    super.firstUpdated(changes);
    this.inputElement = this.shadowRoot.querySelector('.textinput');
    this.inputElement.addEventListener('input', this.inputEventHandlers.input);
    this.inputElement.addEventListener('blur', this.inputEventHandlers.blur);
    this.inputElement.setSelectionRange =
      this.inputEventHandlers.setSelectionRange;
    if (!this.textarea) {
      this.inputElement.addEventListener(
        'keydown',
        this.inputEventHandlers.keydown
      );
    }
    this.inputElement.value = this.value;
    this.onSelectionChange();
    this.doSpellCheck();

    if (changes.has('counter')) {
      let root = this.getParentModax() as any;
      if (root) {
        root = root.shadowRoot;
      }
      if (!root) {
        root = document;
      }
      this.counterElement = root.querySelector(this.counter);
      if (this.counterElement) {
        this.counterElement.text = this.value;
      }
    }
  }

  public updated(changes: Map<string, any>) {
    super.updated(changes);
    if (changes.has('value')) {
      this.setValues([this.value]);
      this.fireEvent('change');

      if (this.cursorStart > -1 && this.cursorEnd > -1) {
        this.inputElement.setSelectionRange(this.cursorStart, this.cursorEnd);
        this.cursorStart = -1;
        this.cursorEnd = -1;
      }
    }
  }

  private handleClear(event: any): void {
    event.stopPropagation();
    event.preventDefault();
    this.setValue(null);
  }

  private updateValue(value: string): void {
    this.inputElement.value = value;
    this.onSelectionChange();

    const cursorStart = this.inputElement.selectionStart;
    const cursorEnd = this.inputElement.selectionEnd;

    const sanitized = this.sanitizeGSM(value);

    if (sanitized !== value) {
      this.cursorStart = cursorStart;
      this.cursorEnd = cursorEnd;
    }

    this.value = sanitized;

    if (this.counterElement) {
      this.counterElement.text = value;
    }

    this.startSpellCheckTimeout();
  }

  private sanitizeGSM(text: string): string {
    return this.gsm ? sanitize(text) : text;
  }

  private handleContainerClick(): void {
    if (this.disabled) {
      return;
    }
    this.inputElement.focus();
  }

  private handleBlur() {
    this.startSpellCheckTimeout(250);
    this.blur();
  }

  private handleInput(update: any): void {
    if (this.disabled) {
      return;
    }

    this.updateValue(update.target.innerText);
    this.setValues([this.value]);
    this.fireEvent('input');
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const input = this;

      if (this.submitOnEnter) {
        const parentModax = input.getParentModax();
        const parentForm = !parentModax ? input.getParentForm() : null;

        this.value = this.values[0];
        this.fireEvent('change');

        // if we don't have something to submit then bail
        if (!parentModax && !parentForm) {
          return;
        }

        input.blur();

        // look for a form to submit
        window.setTimeout(function () {
          // first, look for a modax that contains us
          const modax = input.getParentModax();
          if (modax) {
            input.blur();

            modax.submit();
          } else {
            // otherwise, just look for a vanilla submit button
            const form = input.getParentForm();

            if (form) {
              const submitButton = form.querySelector(
                "input[type='submit']"
              ) as HTMLInputElement;
              if (submitButton) {
                submitButton.click();
              } else {
                form.submit();
              }
            }
          }
        }, 10);
        // this is needed for firefox, would be nice to
        // find a way to do this with a callback instead
      }
    }
  }

  private destroyTooltips() {
    document.querySelector('#spell-checker-tooltip')?.remove();
  }

  private onSelectionChange() {
    const shadowRoot = this.shadowRoot as any;
    const selection = shadowRoot.getSelection();
    let offset = 0;

    if (selection.focusNode) {
      offset = this.inputElement.innerText.search(
        selection.focusNode.textContent
      );
    }

    this.inputElement.selectionStart = offset + selection.focusOffset;
    this.inputElement.selectionEnd = offset + selection.anchorOffset;
  }

  private setSelectionRange(startIndex: number, endIndex: number) {
    const shadowRoot = this.shadowRoot as any;
    const selection = shadowRoot.getSelection();
    const range = document.createRange();

    const currentNode = this.inputElement;
    let charCount = 0;

    function findNode(node: any, index: number, isEnd = false) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const nextCharCount = charCount + child.length;

          if (index <= nextCharCount) {
            range[isEnd ? 'setEnd' : 'setStart'](child, index - charCount);
            return true;
          }

          charCount = nextCharCount;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (findNode(child, index, isEnd)) return true;
        }
      }
      return false;
    }

    charCount = 0;
    findNode(currentNode, startIndex, false); // Set start position
    charCount = 0;
    findNode(currentNode, endIndex, true); // Set end position

    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** we just return the value since it should be a string */
  public serializeValue(value: any): string {
    return value;
  }

  public doSpellCheck(): void {
    if (!this.value) {
      this.spellCheckResults = undefined;
      return;
    }

    if (!this.spellCheckerFunc) {
      this.spellCheckResults = html`${[{ text: this.value }].map(
        this.renderSpellCheckResultPiece.bind(this)
      )}`;
      return;
    }

    this.checkingSpelling = true;
    this.spellCheckResults = html`${this.renderText(this.value)}`;
    this.renderInputContent();

    this.spellCheckerFunc(this.value, this.lang)
      .then((results: SpellCheckerResult[]) => {
        const pieces: SpellCheckerResultPiece[] = [];
        const resultsLength = results.length;
        if (resultsLength === 0) {
          this.checkingSpelling = false;
          return;
        }
        results
          .sort((a, b) => a.from - b.from)
          .reduce((offset, result, index) => {
            // Add the text before the result
            if (offset < result.from) {
              pieces.push({ text: this.value.substring(offset, result.from) });
            }
            // Add the result
            pieces.push({
              text: this.value.substring(result.from, result.to),
              result,
            });
            offset = result.to;
            // Add the text after the last result
            if (index + 1 === resultsLength && offset < this.value.length) {
              pieces.push({ text: this.value.substring(offset) });
            }
            return offset;
          }, 0);
        this.checkingSpelling = false;
        this.spellCheckResults = html`${pieces.map(
          this.renderSpellCheckResultPiece.bind(this)
        )}`;
        this.renderInputContent();
        this.fireCustomEvent(CustomEventType.SpellCorrectionsFound, {
          results,
        });
      })
      .catch(error => {
        console.error('Error checking spelling', error);
        this.checkingSpelling = false;
      });
  }

  private startSpellCheckTimeout(ms = 3000): void {
    this.onSelectionChange();
    if (this.spellCheckerTimeout) {
      clearTimeout(this.spellCheckerTimeout);
    }
    this.spellCheckerTimeout = setTimeout(() => {
      this.doSpellCheck();
    }, ms);
  }

  // @formatter:off
  private renderSpellCheckResultPiece(
    piece: SpellCheckerResultPiece,
    index: number
  ): TemplateResult {
    if (!piece.result) {
      return html`${this.renderText(piece.text)}`;
    }

    // prettier-ignore
    return html`<span class="spell-correction" data-index=${index} @click=${e => {e.preventDefault(); e.stopPropagation(); this.handleSpellCorrectionClick.bind(this)(index, piece)}}>${this.renderText(piece.text)}</span>`;
  }
  // @formatter:on

  private handleSpellCorrectionClick(
    index: number,
    piece: SpellCheckerResultPiece
  ): void {
    const target = this.shadowRoot.querySelector(
      `.spell-correction[data-index="${index}"]`
    );
    const tooltip = document.createElement('div');
    const message = document.createElement('div');
    const suggestions = document.createElement('div');
    const tail = document.createElement('div');

    tooltip.id = 'spell-checker-tooltip';
    message.classList.add('message');
    message.innerText = piece.result.message;
    suggestions.classList.add('suggestions');
    piece.result.suggestions.forEach(suggestion => {
      const suggestionElement = document.createElement('div');
      suggestionElement.innerText = suggestion;
      suggestionElement.classList.add('suggestion');
      suggestionElement.onclick = () => {
        const before = this.value.substring(0, piece.result.from);
        const after = this.value.substring(piece.result.to);
        this.value = before + suggestion + after;
        this.inputElement.focus();
        this.inputElement.setSelectionRange(
          piece.result.from + suggestion.length,
          piece.result.from + suggestion.length
        );
        this.startSpellCheckTimeout(0);
      };
      suggestions.appendChild(suggestionElement);
    });
    tail.classList.add('tail');

    tooltip.appendChild(message);
    tooltip.appendChild(suggestions);
    tooltip.appendChild(tail);

    // tooltip.style.opacity = '0';
    if (!document.querySelector('#spell-checker-tooltip-styles')) {
      const style = document.createElement('style');
      style.textContent = this.tooltipCss.cssText;
      style.id = 'spell-checker-tooltip-styles';
      document.head.appendChild(style);
    }

    window.addEventListener('click', this.inputEventHandlers.destroyTooltips);
    document.querySelector('#spell-checker-tooltip')?.remove();
    document.body.appendChild(tooltip);

    const cr = target.getClientRects()[0];
    const tr = tooltip.getClientRects()[0];
    const wr = document.body.getClientRects()[0];
    if (!cr || !tr) {
      return;
    } else if (
      cr.top > tr.height + 5 &&
      cr.left + cr.width / 2 > tr.width / 2 + 5
    ) {
      const top = cr.top - tr.height - 5;
      const left = cr.left + cr.width / 2 - tr.width / 2;
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    } else if (
      cr.left + cr.width + tr.width + 10 < wr.width &&
      cr.top - 10 > tr.height
    ) {
      const top = cr.top + cr.height / 2 - tr.height / 2 + 2;
      const left = cr.left + cr.width + 10;
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
      tooltip.classList.add('right');
    } else if (cr.left + 10 > tr.width && cr.top - 10 > tr.height) {
      const top = cr.top + cr.height / 2 - tr.height / 2 + 2;
      const left = cr.left - tr.width - 10;
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
      tooltip.classList.add('left');
    } else {
      const top = cr.top + cr.height + 10;
      const left = cr.left + cr.width / 2 - tr.width / 2;
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
      tooltip.classList.add('bottom');
    }
  }

  private renderText(text: string): TemplateResult {
    text = text.replace(/ /g, '&nbsp;'); // Replace spaces with &nbsp;
    text = text.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;'); // Replace tabs with 4 &nbsp;
    if (this.textarea) text = text.replace(/\n/g, '<br />'); // Replace newlines with <br />
    const strings = Object.freeze([text]);
    const raw = Object.freeze([text]);
    const templateStringsArray = Object.assign([], strings, { raw });
    return html`${html(templateStringsArray)}`;
  }

  public getParentModax(): Modax {
    let parent = this as HTMLElement;

    while (parent) {
      if (parent.parentElement) {
        parent = parent.parentElement;
      } else {
        parent = (parent as any).getRootNode().host;
      }

      if (!parent) {
        return null;
      }

      if (parent.tagName == 'TEMBA-MODAX') {
        return parent as Modax;
      }
    }
  }

  public getParentForm(): HTMLFormElement {
    let parent = this as HTMLElement;

    while (parent) {
      if (parent.parentElement) {
        parent = parent.parentElement;
      } else {
        parent = (parent as any).getRootNode().host;
      }

      if (!parent) {
        return null;
      }

      if (parent.tagName === 'FORM') {
        return parent as HTMLFormElement;
      }
    }
  }

  public click(): void {
    super.click();
    this.handleContainerClick();
  }

  public renderInputContent(): void {
    // Have issue when re-rendering content, using Lit template way,
    // after it has been changed so have to do this trick to render manually
    const shadowRoot = this.shadowRoot as any;
    const parent = this.inputElement.parentElement;
    const clone = this.inputElement.cloneNode(true) as HTMLInputElement;
    const focused = shadowRoot.activeElement === this.inputElement;

    try {
      // remove an old input element and add a new one with new rendered content
      this.inputElement.removeEventListener(
        'input',
        this.inputEventHandlers.input
      );
      this.inputElement.removeEventListener(
        'blur',
        this.inputEventHandlers.blur
      );
      this.inputElement.remove();
      clone.innerHTML = '';
      clone.selectionStart = Math.min(
        this.inputElement.selectionStart,
        this.value.length
      );
      clone.selectionEnd = Math.min(
        this.inputElement.selectionEnd,
        this.value.length
      );

      clone.setSelectionRange = this.inputEventHandlers.setSelectionRange;
      render(this.spellCheckResults, clone);
      parent.appendChild(clone);
      this.inputElement = clone;
      this.inputElement.addEventListener(
        'input',
        this.inputEventHandlers.input
      );
      this.inputElement.addEventListener('blur', this.inputEventHandlers.blur);
      this.inputElement.addEventListener(
        'selectionchange',
        this.inputEventHandlers.selectionChange
      );
      if (!this.textarea) {
        this.inputElement.addEventListener(
          'keydown',
          this.inputEventHandlers.keydown
        );
      }
      this.inputElement.value = this.value;
      if (focused) {
        this.inputElement.focus();
        this.setSelectionRange(
          this.inputElement.selectionStart,
          this.inputElement.selectionEnd
        );
      }
    } catch (e) {
      console.log(e);
    }
  }

  public render(): TemplateResult {
    const containerStyle = {
      height: `${this.textarea ? '100%' : 'auto'}`,
    };

    const clear =
      this.clearable && this.inputElement && this.inputElement.value
        ? html` <temba-icon
            name="x"
            class="clear-icon"
            @click=${this.handleClear}
          />`
        : null;

    let input: TemplateResult<any> = html`
      <div
        class="textinput"
        contenteditable=${this.disabled ? 'false' : 'true'}
        name=${this.name}
        type="text"
        maxlength="${ifDefined(this.maxlength)}"
        placeholder=${this.placeholder}
        .disabled=${this.disabled}
      ></div>
    `;

    if (this.textarea) {
      input = html`
        <div
          class="textinput textarea"
          contenteditable=${this.disabled ? 'false' : 'true'}
          name=${this.name}
          placeholder=${this.placeholder}
          .disabled=${this.disabled}
        ></div>
      `;

      if (this.autogrow) {
        input = html` <div class="grow-wrap">${input}</div>`;
      }
    }

    const loading = this.checkingSpelling
      ? html` <div style="position: absolute; right: 10px; bottom: 5px">
          <temba-loading
            id="page-loader"
            units="3"
            size="5"
            color="#ccc"
          ></temba-loading>
        </div>`
      : null;

    return html`
      <temba-field
        name=${this.name}
        .label="${this.label}"
        .helpText="${this.helpText}"
        .errors=${this.errors}
        .widgetOnly=${this.widgetOnly}
        .hideLabel=${this.hideLabel}
        .disabled=${this.disabled}
      >
        <div
          class="input-container"
          style=${styleMap(containerStyle)}
          @click=${this.handleContainerClick}
        >
          ${input} ${clear} ${loading}
          <slot></slot>
        </div>
      </temba-field>
    `;
  }
}
