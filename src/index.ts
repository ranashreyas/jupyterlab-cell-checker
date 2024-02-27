import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { MarkdownCell, ICellModel } from '@jupyterlab/cells';

function checkHtmlNoAlt(htmlString: string): boolean {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  const images = doc.querySelectorAll("img");
  
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img.hasAttribute("alt") || img.getAttribute("alt") === "") {
      return true;
    }
  }
  return false;
}

function checkMDNoAlt(mdString: string): boolean {
  const imageRegex = /!\[\](\([^)]+\))/g;
  return imageRegex.test(mdString);
}

function checkMarkdownCellForImageWithoutAlt(cell: MarkdownCell): boolean {
  const cellText = cell.model.toJSON().source.toString();

  const markdownNoAlt = checkMDNoAlt(cellText);
  const htmlNoAlt = checkHtmlNoAlt(cellText);
  return markdownNoAlt || htmlNoAlt;
}

function attachContentChangedListener(cell: MarkdownCell) {
  cell.model.contentChanged.connect(() => {
    const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(cell);
    if (hasImageWithoutAlt) {
      cell.node.style.backgroundColor = '#ff8080';
    } else {
      cell.node.style.backgroundColor = '';
    }
  });
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_accessibility:plugin',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker) => {
    console.log('JupyterLab extension jupyterlab_accessibility is activated!');

    notebookTracker.currentChanged.connect((sender, notebookPanel) => {
      if (!notebookPanel) return;

      notebookPanel.context.ready.then(() => {
        const { content } = notebookPanel;

        // Attach listeners to existing cells + on load initial state
        content.widgets.forEach(cell => {
          if (cell.model.type === 'markdown') {
            const markdownCell = cell as MarkdownCell;

            const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(markdownCell);
            if (hasImageWithoutAlt) {
              markdownCell.node.style.backgroundColor = '#ff8080';
            } else {
              markdownCell.node.style.backgroundColor = '';
            }

            attachContentChangedListener(markdownCell);
          }
        });

        // Attach listeners to cells added in the future
        if (content.model) {
          content.model.cells.changed.connect((sender, args) => {
            if (args.type === 'add') {
              args.newValues.forEach((cellModel: ICellModel) => {
                const cell = content.widgets.find(c => c.model.id === cellModel.id);
                if (cell && cell.model.type === 'markdown') {
                  attachContentChangedListener(cell as MarkdownCell);
                }
              });
            }
          });
        }
      });
    });
  }
};

export default plugin;
