import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { MarkdownCell, ICellModel } from '@jupyterlab/cells';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { Menu } from '@lumino/widgets';

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
      if (hasImageWithoutAlt) {
        cell.node.style.backgroundColor = '#ff8080';
      } else {
        cell.node.style.backgroundColor = '';
      }
    } else {
      cell.node.style.backgroundColor = '';
    }
  });
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_accessibility:plugin',
  autoStart: true,
  requires: [INotebookTracker, IMainMenu],
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker, mainMenu: IMainMenu) => {
    console.log('JupyterLab extension jupyterlab_accessibility is activated!');
    
    let isEnabled = true;

    const accessibilityMenu = new Menu({ commands: app.commands });
    accessibilityMenu.title.label = 'Accessibility';
    mainMenu.addMenu(accessibilityMenu);

    const toggleCommand = 'jupyterlab_accessibility:toggle';
    app.commands.addCommand(toggleCommand, {
      label: 'Toggle Accessibility Checks',
      isToggled: () => isEnabled,
      execute: () => {
        isEnabled = !isEnabled;
        console.log(`Accessibility checks ${isEnabled ? 'enabled' : 'disabled'}.`);

        notebookTracker.forEach(notebookPanel => {
          notebookPanel.content.widgets.forEach(cell => {
            if (cell.model.type === 'markdown') {
              const markdownCell = cell as MarkdownCell;
              if (!isEnabled) {
                markdownCell.node.style.backgroundColor = '';
              } else {

                const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(markdownCell);
                if (hasImageWithoutAlt) {
                  markdownCell.node.style.backgroundColor = '#ff8080';
                } else {
                  markdownCell.node.style.backgroundColor = '';
                }
              }
            }
          });
        });
      }
    });

    accessibilityMenu.addItem({ command: toggleCommand });

    notebookTracker.currentChanged.connect((sender, notebookPanel) => {
      if (!notebookPanel) return;
      
      notebookPanel.context.ready.then(() => {
        const { content } = notebookPanel;

        content.widgets.forEach(cell => {
          if (cell.model.type === 'markdown') {
            const markdownCell = cell as MarkdownCell;
            attachContentChangedListener(markdownCell, () => isEnabled);
            
            if (isEnabled) {
              const hasImageWithoutAlt = checkMarkdownCellForImageWithoutAlt(markdownCell);
              if (hasImageWithoutAlt) {
                markdownCell.node.style.backgroundColor = '#ff8080';
              } else {
                markdownCell.node.style.backgroundColor = '';
              }
            } else {
              markdownCell.node.style.backgroundColor = '';
            }
          }
        });

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
