import {
  ILabShell,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ToolbarButton } from '@jupyterlab/apputils';
import { MarkdownCell, ICellModel, CodeCell, Cell } from '@jupyterlab/cells';
import { IDisposable } from '@lumino/disposable';
import { Widget } from '@lumino/widgets';
import { LabIcon } from '@jupyterlab/ui-components';

function getImageTransparency(imgString: string, notebookPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous'; // Needed for CORS-compliant images

    try {
      new URL(imgString);
      img.src = imgString;
    } catch (_) {
      const baseUrl = document.location.origin;
      var finalPath = `${baseUrl}/files/${imgString}`
      // console.log(finalPath);
      img.src = finalPath;
    }

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;

      const context = canvas.getContext('2d');
      if (!context) {
        console.log('Failed to get canvas context');
        resolve(10);
        return;
      }

      context.drawImage(img, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      let transparentPixelCount = 0;
      const totalPixels = data.length / 4;

      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
          transparentPixelCount++;
        }
      }

      const transparencyPercentage = (transparentPixelCount / totalPixels) * 100;
      console.log(10 - transparencyPercentage/10);
      
      resolve(10 - transparencyPercentage/10)
    };

    img.onerror = () => reject('Failed to load image');
  });
}

async function checkHtmlNoAlt(htmlString: string, myPath: string, isCodeCellOutput: boolean): Promise<string[]> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  const images = doc.querySelectorAll("img");

  let accessibilityTests: string[] = [];
  if(!isCodeCellOutput){
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img.hasAttribute("alt") || img.getAttribute("alt") === "") {
        accessibilityTests.push("Alt");
      }
    }
  }

  const randomNumberPromises = Array.from(images).map((img: HTMLImageElement) => getImageTransparency(img.src, myPath));
  const randomNumbers = await Promise.all(randomNumberPromises);

  accessibilityTests = [...accessibilityTests, ...randomNumbers.map(String)];

  return accessibilityTests;
}

async function checkMDNoAlt(mdString: string, myPath: string): Promise<string[]> {
  const imageNoAltRegex = /!\[\](\([^)]+\))/g;
  const allImagesRegex = /!\[.*?\]\((.*?)\)/g;
  let accessibilityTests: string[] = [];

  let match: RegExpExecArray | null;
  const imageUrls: string[] = [];

  while ((match = allImagesRegex.exec(mdString)) !== null) {
      const imageUrl = match[1];
      if (imageUrl) {
          imageUrls.push(imageUrl);
      }
  }


  if (imageNoAltRegex.test(mdString)){
    accessibilityTests.push("Alt")
  }

  const randomNumberPromises = Array.from(imageUrls).map((i: string) => getImageTransparency(i, myPath));
  const randomNumbers = await Promise.all(randomNumberPromises);

  accessibilityTests = [...accessibilityTests, ...randomNumbers.map(String)];

  return accessibilityTests;
}

async function checkMarkdownCellForImageWithoutAlt(cell: Cell, myPath: string): Promise<string[]> {
  if(cell.model.type == 'markdown'){
    cell = cell as MarkdownCell;
    const cellText = cell.model.toJSON().source.toString();

    const markdownNoAlt = await checkMDNoAlt(cellText, myPath);
    const htmlNoAlt = await checkHtmlNoAlt(cellText, myPath, false);
    var issues = htmlNoAlt.concat(markdownNoAlt)
    return issues;
  } else {
    return [];
  }
}

async function checkCodeCellForImageWithTransparency(cell: Cell, myPath: string): Promise<string[]> {
  if(cell.model.type == 'code'){
    const codeCell = cell as CodeCell;
    const outputText = codeCell.outputArea.node.outerHTML;

    const htmlTransparancyIssues = await checkHtmlNoAlt(outputText, myPath, true);
    return htmlTransparancyIssues;
  } else {
    return [];
  }
  
}

async function attachContentChangedListener(altCellList: AltCellList, cell: Cell, isEnabled: () => boolean, myPath: string) {
  cell.model.contentChanged.connect(async (sender, args) => {

    if (isEnabled()){
      const mdCellIssues = await checkMarkdownCellForImageWithoutAlt(cell, myPath);
      const hasImageWithoutAlt = await checkCodeCellForImageWithTransparency(cell, myPath);
      var issues = mdCellIssues.concat(hasImageWithoutAlt)

      applyVisualIndicator(altCellList, cell, issues);
    } else {
      applyVisualIndicator(altCellList, cell, []);
    }
  });
  
}

function applyVisualIndicator(altCellList: AltCellList, cell: Cell, listIssues: string[]) {
  const indicatorId = 'accessibility-indicator-' + cell.model.id;
  altCellList.removeCell(cell.model.id);

  let applyIndic = false;
  for (let i = 0; i < listIssues.length; i++) {
    if (listIssues[i] == "Alt") {
      altCellList.addCell(cell.model.id, "Cell Error: Missing Alt Tag");
      applyIndic = true;
    } else {
      var score = Number(listIssues[i]);
      if (score < 9) {
        altCellList.addCell(cell.model.id, "Cell Error: Low Image Visibility");
        applyIndic = true;
      }
    }
  }
  
  if (applyIndic) {

    if (!document.getElementById(indicatorId)) {
      let indicator = document.createElement('div');
      indicator.id = indicatorId;
      indicator.style.position = 'absolute';
      indicator.style.top = '30px';
      indicator.style.left = '45px';
      indicator.style.width = '15px';
      indicator.style.height = '15px';
      indicator.style.borderRadius = '50%';
      indicator.style.backgroundColor = '#ff8080';
      cell.node.appendChild(indicator);
    }
  } else {
    let indicator = document.getElementById(indicatorId);
    indicator?.remove();
    altCellList.removeCell(cell.model.id);
  }

}

async function addToolbarButton(labShell: ILabShell, altCellList: AltCellList, notebookPanel: NotebookPanel, isEnabled: () => boolean, toggleEnabled: () => void, myPath: string): Promise<IDisposable> {
  
  console.log("make button")

  const button = new ToolbarButton({

    label: '🌐 Check Alt-Text',
    onClick: () => {
      toggleEnabled();
      if(isEnabled()){
        labShell.activateById("AltCellList");
      } else {
        labShell.collapseRight();
      }
      
      notebookPanel.content.widgets.forEach(async cell => {
        
        if (isEnabled()){
          const mdCellIssues = await checkMarkdownCellForImageWithoutAlt(cell, myPath);
          const hasImageWithoutAlt = await checkCodeCellForImageWithTransparency(cell, myPath);
          var issues = mdCellIssues.concat(hasImageWithoutAlt)
    
          applyVisualIndicator(altCellList, cell, issues);
        } else {
          applyVisualIndicator(altCellList, cell, []);
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

const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_accessibility:plugin',
  autoStart: true,
  requires: [INotebookTracker, ILabShell],
  activate: (app: JupyterFrontEnd, notebookTracker: INotebookTracker, labShell: ILabShell) => {
    console.log("before wait")
    new Promise<void>(resolve => {
      setTimeout(resolve, 1000);
    }).then(() => {
      console.log('JupyterLab extension jupyterlab_accessibility is activated!');

      let isEnabled = true;
      // Function to toggle the isEnabled state
      const toggleEnabled = () => {
        isEnabled = !isEnabled;
        console.log(`Accessibility checks ${isEnabled ? 'enabled' : 'disabled'}.`);
      };

      const accessibilityIcon = new LabIcon({
        name: 'accessibility',
        svgstr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#154F92" d="M256 48c114.953 0 208 93.029 208 208 0 114.953-93.029 208-208 208-114.953 0-208-93.029-208-208 0-114.953 93.029-208 208-208m0-40C119.033 8 8 119.033 8 256s111.033 248 248 248 248-111.033 248-248S392.967 8 256 8zm0 56C149.961 64 64 149.961 64 256s85.961 192 192 192 192-85.961 192-192S362.039 64 256 64zm0 44c19.882 0 36 16.118 36 36s-16.118 36-36 36-36-16.118-36-36 16.118-36 36-36zm117.741 98.023c-28.712 6.779-55.511 12.748-82.14 15.807.851 101.023 12.306 123.052 25.037 155.621 3.617 9.26-.957 19.698-10.217 23.315-9.261 3.617-19.699-.957-23.316-10.217-8.705-22.308-17.086-40.636-22.261-78.549h-9.686c-5.167 37.851-13.534 56.208-22.262 78.549-3.615 9.255-14.05 13.836-23.315 10.217-9.26-3.617-13.834-14.056-10.217-23.315 12.713-32.541 24.185-54.541 25.037-155.621-26.629-3.058-53.428-9.027-82.141-15.807-8.6-2.031-13.926-10.648-11.895-19.249s10.647-13.926 19.249-11.895c96.686 22.829 124.283 22.783 220.775 0 8.599-2.03 17.218 3.294 19.249 11.895 2.029 8.601-3.297 17.219-11.897 19.249z"/></svg>'
      });

      const altCellList: AltCellList = new AltCellList(notebookTracker);
      altCellList.id = 'AltCellList'; // Widgets need an id
      altCellList.title.icon = accessibilityIcon;
      labShell.add(altCellList, 'right');
      labShell.activateById('AltCellList');
      
      // When a new notebook is created or opened, add the toolbar button
      notebookTracker.widgetAdded.connect((sender, notebookPanel: NotebookPanel) => {
        console.log("able to add toolbar button");
        addToolbarButton(labShell, altCellList, notebookPanel, () => isEnabled, toggleEnabled, notebookTracker.currentWidget!.context.path);
      });

      notebookTracker.currentChanged.connect((sender, notebookPanel) => {
        if (!notebookPanel) return;
        
        notebookPanel.context.ready.then(() => {
          const { content } = notebookPanel;

          //for each existing cell, attach a content changed listener
          content.widgets.forEach(async cell => {
        
          
            attachContentChangedListener(altCellList, cell, () => isEnabled, notebookTracker.currentWidget!.context.path);

            //for each existing cell, check the accessibility once to initially flag it or not
            if (isEnabled){
              const mdCellIssues = await checkMarkdownCellForImageWithoutAlt(cell, notebookTracker.currentWidget!.context.path);
              const hasImageWithoutAlt = await checkCodeCellForImageWithTransparency(cell, notebookTracker.currentWidget!.context.path);
              var issues = mdCellIssues.concat(hasImageWithoutAlt)
        
              applyVisualIndicator(altCellList, cell, issues);
            } else {
              applyVisualIndicator(altCellList, cell, []);
            }
            
          });

          //every time a cell is added, attach a content listener to it
          if (content.model) {
            content.model.cells.changed.connect((sender, args) => {
              if (args.type === 'add') {
                args.newValues.forEach((cellModel: ICellModel) => {
                  const cell = content.widgets.find(c => c.model.id === cellModel.id);
                  if(cell){
                    const newCell = cell as Cell
                    attachContentChangedListener(altCellList, newCell, () => isEnabled, notebookTracker.currentWidget!.context.path);  
                  }          
                });
              }
            });
          }
        });
      });
    });
  }
};

class AltCellList extends Widget {
  
  private _listCells: HTMLElement;
  private _cellMap: Map<string, HTMLElement[]>;
  private _notebookTracker: INotebookTracker;

  constructor(notebookTracker: INotebookTracker) {
    super();
    this._cellMap = new Map<string, HTMLElement[]>();
    this._listCells = document.createElement('div');
    this._notebookTracker = notebookTracker;

    let title = document.createElement('h2');
    title.innerHTML = "Cells with Accessibility Issues";
    title.style.margin = '15px';

    this.node.appendChild(title);
    this.node.appendChild(this._listCells);
  }

  addCell(cellId: string, buttonContent: string): void {
      const listItem = document.createElement('div');
      listItem.id = 'cell-' + cellId + "_" + buttonContent;

      const button = document.createElement('button');
      button.classList.add("jp-toast-button");
      button.classList.add("jp-mod-link");
      button.classList.add("jp-mod-small");
      button.classList.add("jp-Button");
      button.style.margin = '5px';
      button.style.marginRight = '15px';
      button.style.marginLeft = '15px';
      button.textContent = buttonContent;

      button.addEventListener('click', () => {
        this.scrollToCell(cellId);
      });


      var add = true;

      if (this._cellMap.has(cellId)){
        
        var existingList = this._cellMap.get(cellId)

        existingList!.forEach(b => {          
          if (b.textContent == buttonContent) {
            add = false;
          }
        })

        existingList!.push(listItem)
        this._cellMap.set(cellId, existingList!);
      } else {
        this._cellMap.set(cellId, [listItem]);
      }

      if (add) {
        listItem.appendChild(button);
        this._listCells.appendChild(listItem);
      }
      
      
  }

  removeCell(cellId: string): void {
    //get list of error buttons related to this cell
    const listItem = this._cellMap.get(cellId);

    if (listItem != null){
      listItem.forEach((btn) => {

      for (let item of this._listCells.children) {
        if (btn.id == item.id) {
          this._listCells.removeChild(btn);
        }
      }
          
      });
    }
    if(this._cellMap.has(cellId)){
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

        const originalStyle = cell.node.style.transition;
        cell.node.style.transition = 'background-color 0.5s ease';
        cell.node.style.backgroundColor = '#ffff99';
        setTimeout(() => {
          cell.node.style.backgroundColor = '';
          cell.node.style.transition = originalStyle;
        }, 800); // Flash duration
      }
    }
  }
  
}

export default plugin;