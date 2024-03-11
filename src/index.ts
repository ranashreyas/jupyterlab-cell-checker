import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ToolbarButton } from '@jupyterlab/apputils';
import { MarkdownCell, ICellModel } from '@jupyterlab/cells';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { IDisposable } from '@lumino/disposable';
// import { Menu } from '@lumino/widgets';


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

function attachContentChangedListener(cell: MarkdownCell, isEnabled: () => boolean) {
  cell.model.contentChanged.connect(() => {
    if (isEnabled()){
      const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(cell);
      applyVisualIndicator(cell, hasImageWithoutAlt);
    } else {
      applyVisualIndicator(cell, false);
    }
  });
}

function applyVisualIndicator(cell: MarkdownCell, applyIndic: boolean) {
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
  } else {
    let indicator = document.getElementById(indicatorId);
    indicator?.remove();
  }
}

function addToolbarButton(notebookPanel: NotebookPanel, isEnabled: () => boolean, toggleEnabled: () => void): IDisposable {
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
            applyVisualIndicator(markdownCell, hasImageWithoutAlt);
          } else {
            applyVisualIndicator(markdownCell, false);
          }
        }
      });
    },

    tooltip: 'Toggle Alt-text Check'
  });

  button.id = "alt-text-check-toggle";
  notebookPanel.toolbar.insertItem(10, 'altTextCheck', button);
  
  let elem = document.getElementById('alt-text-check-toggle');
  elem!.style.backgroundColor = '#5c94ed';

  return button;
}

function updateButtonAppearance(button: ToolbarButton, isOn: boolean) {
  if (isOn) {
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
  requires: [INotebookTracker, IMainMenu],
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker, mainMenu: IMainMenu) => {
    console.log('JupyterLab extension jupyterlab_accessibility is activated!');
    
    let isEnabled = true; // Flag to track the extension's enabled state

    // Function to toggle the isEnabled state
    const toggleEnabled = () => {
      isEnabled = !isEnabled;
      console.log(`Accessibility checks ${isEnabled ? 'enabled' : 'disabled'}.`);
    };

    // When a new notebook is created or opened, add the toolbar button
    notebookTracker.widgetAdded.connect((sender, notebookPanel: NotebookPanel) => {
      addToolbarButton(notebookPanel, () => isEnabled, toggleEnabled);
    });

    notebookTracker.currentChanged.connect((sender, notebookPanel) => {
      if (!notebookPanel) return;
      
      notebookPanel.context.ready.then(() => {
        const { content } = notebookPanel;

        //for each existing cell, attach a content changed listener
        content.widgets.forEach(cell => {
          if (cell.model.type === 'markdown') {
            const markdownCell = cell as MarkdownCell;
            attachContentChangedListener(markdownCell, () => isEnabled);
            
            //for each existing cell, check the accessibility once to initially flag it or not
            if (isEnabled) {
              const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(markdownCell);
              applyVisualIndicator(markdownCell, hasImageWithoutAlt);
            } else {
              applyVisualIndicator(markdownCell, false);
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
                  attachContentChangedListener(cell as MarkdownCell, () => isEnabled);
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
