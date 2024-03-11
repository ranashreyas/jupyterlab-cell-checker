import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ToolbarButton } from '@jupyterlab/apputils';
import { MarkdownCell, ICellModel } from '@jupyterlab/cells';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { IDisposable } from '@lumino/disposable';
import { IStatusBar } from '@jupyterlab/statusbar';
import { Widget } from '@lumino/widgets';


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

function attachContentChangedListener(altCellList: AltCellList, cell: MarkdownCell, isEnabled: () => boolean) {
  cell.model.contentChanged.connect(() => {
    if (isEnabled()){
      const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(cell);
      applyVisualIndicator(altCellList, cell, hasImageWithoutAlt);
    } else {
      applyVisualIndicator(altCellList, cell, false);
    }
  });
}


function applyVisualIndicator(altCellList: AltCellList, cell: MarkdownCell, applyIndic: boolean) {
  const indicatorId = `accessibility-indicator-${cell.model.id}`;

  if (applyIndic) {
    let indicator = document.createElement('div');
    indicator.id = indicatorId;
    indicator.style.position = 'absolute';
    indicator.style.top = '12px';
    indicator.style.left = '44px';
    indicator.style.width = '15px';
    indicator.style.height = '15px';
    indicator.style.borderRadius = '50%';
    indicator.style.backgroundColor = '#ff8080';
    cell.node.appendChild(indicator);
    altCellList.addCell(cell.model.id);
  } else {
    let indicator = document.getElementById(indicatorId);
    indicator?.remove();
    altCellList.removeCell(cell.model.id);
  }

}

function addToolbarButton(altCellList: AltCellList, notebookPanel: NotebookPanel, isEnabled: () => boolean, toggleEnabled: () => void): IDisposable {
  const button = new ToolbarButton({
    // className: 'my-altTextCheck-button',
    label: 'Alt Text Check',
    onClick: () => {
      toggleEnabled();
      updateButtonAppearance(button, isEnabled());
      notebookPanel.content.widgets.forEach(cell => {
        if (cell.model.type === 'markdown') {
          const markdownCell = cell as MarkdownCell;
          if (isEnabled()) {
            const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(markdownCell);
            applyVisualIndicator(altCellList, markdownCell, hasImageWithoutAlt);
          } else {
            applyVisualIndicator(altCellList, markdownCell, false);
          }
        }
      });
    },

    tooltip: 'Toggle Alt-text Check'
  });

  button.id = "alt-text-check-toggle";
  notebookPanel.toolbar.insertItem(10, 'altTextCheck', button);
  
  let elem = document.getElementById('alt-text-check-toggle');
  elem!.style.backgroundColor = '#0000';

  return button;
}

function updateButtonAppearance(button: ToolbarButton, isOn: boolean) {
  if (!isOn) {
    let elem = document.getElementById('alt-text-check-toggle');
    elem!.style.backgroundColor = '#5c94ed';
  } else {
    let elem = document.getElementById('alt-text-check-toggle');
    elem!.style.backgroundColor = '#0000';
  }
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_accessibility:plugin',
  autoStart: true,
  requires: [INotebookTracker, IMainMenu, IStatusBar],
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker, mainMenu: IMainMenu, statusBar: IStatusBar | null) => {
    console.log('JupyterLab extension jupyterlab_accessibility is activated!');

    let isEnabled = true;
    // Function to toggle the isEnabled state
    const toggleEnabled = () => {
      isEnabled = !isEnabled;
      console.log(`Accessibility checks ${isEnabled ? 'enabled' : 'disabled'}.`);
    };

    const altCellList: AltCellList = new AltCellList(notebookTracker);
    altCellList.id = 'JupyterShoutWidget'; // Widgets need an id
    app.shell.add(altCellList, 'right');
    
    // When a new notebook is created or opened, add the toolbar button
    notebookTracker.widgetAdded.connect((sender, notebookPanel: NotebookPanel) => {
      addToolbarButton(altCellList, notebookPanel, () => isEnabled, toggleEnabled);
    });

    notebookTracker.currentChanged.connect((sender, notebookPanel) => {
      if (!notebookPanel) return;
      
      notebookPanel.context.ready.then(() => {
        const { content } = notebookPanel;

        //for each existing cell, attach a content changed listener
        content.widgets.forEach(cell => {
          if (cell.model.type === 'markdown') {
            const markdownCell = cell as MarkdownCell;
            attachContentChangedListener(altCellList, markdownCell, () => isEnabled);
            
            //for each existing cell, check the accessibility once to initially flag it or not
            if (isEnabled) {
              const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(markdownCell);
              applyVisualIndicator(altCellList, markdownCell, hasImageWithoutAlt);
            } else {
              applyVisualIndicator(altCellList, markdownCell, false);
            }
          }
        });

        //every time a cell is added, attach a content listener to it
        if (content.model) {
          content.model.cells.changed.connect((sender, args) => {
            if (args.type === 'add') {
              args.newValues.forEach((cellModel: ICellModel) => {
                const cell = content.widgets.find(c => c.model.id === cellModel.id);
                if (cell && cell.model.type === 'markdown') {
                  attachContentChangedListener(altCellList, cell as MarkdownCell, () => isEnabled);
                }
              });
            }
          });
        }
      });
    });
  }
};

class AltCellList extends Widget {
  
  private _listCells: HTMLElement;
  private _cellMap: Map<string, HTMLElement>;
  private _notebookTracker: INotebookTracker;

  constructor(notebookTracker: INotebookTracker) {
    super();
    this._cellMap = new Map<string, HTMLElement>();
    this._listCells = document.createElement('ul');
    this._notebookTracker = notebookTracker;
    this.node.appendChild(this._listCells);
  }

  addCell(cellId: string): void {
    if (!this._cellMap.has(cellId)) {
      const listItem = document.createElement('li');
      listItem.id = `cell-${cellId}`;
      listItem.style.listStyleType = 'None';

      const button = document.createElement('button');
      button.textContent = "Cell Id: " + cellId.slice(0,5);
      button.style.margin = '5px';
      button.addEventListener('click', () => {
        this.scrollToCell(cellId);
      });
      
      listItem.appendChild(button);
      this._listCells.appendChild(listItem);
      this._cellMap.set(cellId, listItem);
    }
  }

  removeCell(cellId: string): void {
    const listItem = this._cellMap.get(cellId);
    if (listItem) {
      this._listCells.removeChild(listItem);
      this._cellMap.delete(cellId);
    }
  }

  scrollToCell(cellId: string): void {
    const notebookPanel = this._notebookTracker.currentWidget;
    const notebook = notebookPanel!.content;
    
    for (let i = 0; i < notebook.widgets.length; i++) {
      const cell = notebook.widgets[i];
      if (cell.model.id === cellId) {
        cell.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
  
}

export default plugin;
