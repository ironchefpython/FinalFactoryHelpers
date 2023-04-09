import { Base64 } from 'https://cdn.jsdelivr.net/npm/js-base64@3.7.5/base64.mjs';
import 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';


const DEFLATE_OPTIONS = {to: 'string'};

const BACKGROUND_DEFAULT = "black";
const BACKGROUND_HIGHLIGHT = "#414a4c";
const CANVAS_BACKGROUND = "grey";
const NO_CONNECT_BACKGROUND = "red"
const CONNECT_BACKGROUND = "midnightblue"

const STROKE_HIGHLIGHT = "green";
const WIDTH_STROKE = .03;
const STOKE_DEFAULT = "black";


const UP = 0b1;
const RIGHT = 0b10;
const DOWN = 0b100;
const LEFT = 0b1000;

const ANY_DIRECTION = UP + RIGHT + DOWN + LEFT;
const HORIZONTAL = RIGHT + LEFT;
const VERTICAL = UP + DOWN;

const UNCONNECT_SIZE = 0.04;
const MARGIN_ITEM = UNCONNECT_SIZE + WIDTH_STROKE -0.02;

const HIGHLIGHTED = 1;


const rotate = (sides, direction) => {
    const v = sides << (direction % 4);
    return (v & 15) + ((v & ~15) >> 4);
}

const rotate180 = sides => rotate(sides, 2);


const decode = bps => JSON.parse(pako.inflate(Base64.toUint8Array(bps.substring(16)), DEFLATE_OPTIONS));

const readItems = j => j["Items"].map(getInfo);

const readData = async url => {
    const itemData = await fetch(url)
        .then(response => response.json())
        .then(jsonData => Object.fromEntries(jsonData.items.map(item => [item.name, item])));
    const itemOverrides = await fetch("overrides-"+url)
        .then(response => response.json())
    for (const name in itemOverrides) {
        Object.assign(itemData[name], itemOverrides[name]);
    }

    const get = item => itemData[item.itemName];

    const connections = item => {
        const data = get(item);
        return rotate(data.connections ?? 0, item.direction);
    }

    const compatable = (value, name, categories) => (value == name) || categories.includes(value);

    const facing = item => rotate(UP, item.direction);

    const getMask = (item, slots, direction) => {
        switch(rotate(direction, 4-item.direction)) {
            case UP:
                return slots[0];
            case RIGHT:
                return slots[2];
            case DOWN:
                return slots[4];
            case LEFT:
                return slots[6];
        }
        console.log("error")
    }

    const accessible = (item1, item2, direction) => {
        const { slots = undefined } = get(item2);
        if (!slots) {
            return true;
        }

        // TODO update for 64 bits
        const match = (direction & VERTICAL) 
            ? (((1 << (item1.right- item1.left))-1) << (item1.left - item2.left))
            : (((1 << (item1.bottom - item1.top)) - 1) << (item1.top - item2.top));
        const slotMask = getMask(item2, slots, direction);
        console.log(slotMask + ":" + match);0
        return (slotMask & match) == match;
    }

    const connects = (item1, item2, direction) => {
        const { connect, extend, chain, mate } = get(item1);
        const categories = get(item2).categories ?? [];
        if (compatable(connect, item2.itemName, categories)) {
            return accessible(item1, item2, direction);
        }
        if (compatable(extend, item2.itemName, categories)) {
            return direction & connections(item2);
        }
        if (compatable(chain, item2.itemName, categories)) {
            return facing(item1) != rotate180(facing(item2));
        }
        if (compatable(mate, item2.itemName, categories)) {
            return connections(item1) == rotate180(facing(item2));
        }
        return false;
    }

    return { get, connections, connects };
}

const adjacent = (item1, item2) => {
    if (item1.top == item2.bottom) {
        if ((item1.left - item2.left) * (item1.right - item2.right) <= 0) {
            return UP;
        }
    } else if (item1.bottom == item2.top) {
        if ((item1.left - item2.left) * (item1.right - item2.right) <= 0) {
            return DOWN;
        }
    } else if (item1.left == item2.right) {
        if ((item1.top - item2.top) * (item1.bottom - item2.bottom) <= 0) {
            return LEFT;
        }
    } else if (item1.right == item2.left) {
        if ((item1.top - item2.top) * (item1.bottom - item2.bottom) <= 0) {
            return RIGHT;
        }
    }
    return 0;
}

const connected = (item1, item2, direction, itemData) => {
    const connections1 = itemData.connections(item1);
    if ((connections1 & direction) && itemData.connects(item1, item2, direction)) {
        return true;
    }
    const connections2 = itemData.connections(item2);
    const reversed = rotate180(direction);
    if ((connections2 & reversed) && itemData.connects(item2, item1, reversed)) {
        return true;
    } 
    return false;
}


const getInfo = obj => {
    const center_x = obj['OriginalPlacedPosition']['x'] / 10;
    const center_y = obj['OriginalPlacedPosition']['z'] / 10;
    const width = obj['Width'];
    const height = obj['Length'];

    return {
        width,
        height,
        direction: obj['CurrentDirection'],
        top: -Math.round(center_y + height / 2),
        bottom: -Math.round(center_y - height / 2),
        left: Math.round(center_x - width / 2),
        right: Math.round(center_x + width / 2),
        itemName: obj['ItemName']
    };
}


const makeRender = (canvas, itemData, boundingBox, scalingFactor) => {
    canvas.width = (boundingBox.right - boundingBox.left) * scalingFactor;
    canvas.height = (boundingBox.bottom - boundingBox.top) * scalingFactor;

    const eventXScale = canvas.width / canvas.clientWidth;
    const eventYScale = canvas.height / canvas.clientHeight;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = CANVAS_BACKGROUND;
    ctx.fillRect(0,0,canvas.width, canvas.height);

    const {top, left} = boundingBox;

    const boxes = [];

    const drawRect = (rtop, rbottom, rleft, rright, fill, stroke) => {
        const box = new Path2D();
        box.rect(
            (rleft -left) * scalingFactor, 
            (rtop - top) * scalingFactor, 
            (rright - rleft) * scalingFactor, 
            (rbottom - rtop) * scalingFactor,
            0.5 + scalingFactor);
        ctx.fillStyle = fill;
        ctx.fill(box);
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = WIDTH_STROKE * scalingFactor;
            ctx.stroke(box);
        }
        return box;
    }


    const drawItem = (item, state)  => {
        const stroke = state == HIGHLIGHTED ? STROKE_HIGHLIGHT : STOKE_DEFAULT;
        const fill = state == HIGHLIGHTED ? BACKGROUND_HIGHLIGHT : BACKGROUND_DEFAULT;
        const box = drawRect(item.top+MARGIN_ITEM, item.bottom-MARGIN_ITEM, item.left+MARGIN_ITEM, item.right-MARGIN_ITEM, fill, stroke);
        boxes.push(box);
        const connections = itemData.connections(item);
        const center = (item.left + item.right) / 2;
        const middle = (item.top + item.bottom) / 2;
        if (connections & UP) {
            drawRect(item.top, item.top+UNCONNECT_SIZE, center-UNCONNECT_SIZE, center+UNCONNECT_SIZE, NO_CONNECT_BACKGROUND);
        }
        if (connections & DOWN) {
            drawRect(item.bottom-+UNCONNECT_SIZE, item.bottom, center-UNCONNECT_SIZE, center+UNCONNECT_SIZE, NO_CONNECT_BACKGROUND);
        }
        if (connections & LEFT) {
            drawRect(middle-UNCONNECT_SIZE, middle+UNCONNECT_SIZE, item.left, item.left+UNCONNECT_SIZE, NO_CONNECT_BACKGROUND);
        }
        if (connections & RIGHT) {
            drawRect(middle-UNCONNECT_SIZE, middle+UNCONNECT_SIZE, item.right-UNCONNECT_SIZE, item.right, NO_CONNECT_BACKGROUND);
        }
    }


    // const wordWrap = (text, width)

    const drawLabel = item => {
        const width = (item.right - item.left) * scalingFactor;
        const size = Math.round(scalingFactor/5);
        const labelY = (item.top - top) * scalingFactor + size;
        ctx.font = size + "px Arial";
        ctx.fillStyle = "white";
        const words = item.itemName.split(' ');
        let line = '';
        let lines = [];
        for (let i = 0; i < words.length; i++) {
          const testLine = line + words[i] + ' ';
          const testWidth = ctx.measureText(testLine).width;
          if (testWidth > width - 20) {
            lines.push(line.trim());
            line = words[i] + ' ';
          } else {
            line = testLine;
          }
        }
        lines.push(line.trim());
        lines = lines.filter(l => !!l)
        for (let i = 0; i < lines.length; i++) {
            const labelWidth = ctx.measureText(lines[i]).width;
            ctx.fillText(lines[i], (item.left - left) * scalingFactor + width / 2 - labelWidth / 2, labelY + i * size);
        }
      }

      
    const addImage = item => {
        let x = (item.left - left) * scalingFactor;
        let y = (item.top - top) * scalingFactor;
        let width = item.width * scalingFactor;
        let height = item.height * scalingFactor;
    
        const img = new Image();
        img.src = `Icons/${item.itemName.replace(/\s/g, '')}.png`;
        img.onload = () => {
          const imgAspect = img.width / img.height;
          const boxAspect = width / height;
          let imgWidth = width;
          let imgHeight = height;
          if (imgAspect > boxAspect) {
            imgWidth = Math.min(width, img.width);
            imgHeight = imgWidth / imgAspect;
          } else {
            imgHeight = Math.min(height, img.height);
            imgWidth = imgHeight * imgAspect;
          }
          const imgX = x + (width - imgWidth) / 2;
          const imgY = y + (height - imgHeight) / 2;
          ctx.drawImage(img, imgX, imgY, imgWidth, imgHeight);
        };
      }
    

    


    const render = (item, state) => {
        drawItem(item, state);
        addImage(item);
        drawLabel(item);
    };

    const renderAdjacent = (item1, item2, direction) => {
        switch (direction) {
            case(UP):
                drawRect(item1.top-UNCONNECT_SIZE, item1.top+UNCONNECT_SIZE, Math.max(item1.left, item2.left)+UNCONNECT_SIZE, Math.min(item1.right, item2.right)-UNCONNECT_SIZE, CONNECT_BACKGROUND)
                break;
            case(LEFT):
                drawRect(Math.max(item1.top, item2.top)+UNCONNECT_SIZE, Math.min(item1.bottom, item2.bottom)-UNCONNECT_SIZE, item1.left-UNCONNECT_SIZE, item1.left+UNCONNECT_SIZE, CONNECT_BACKGROUND)
                break;
            case(DOWN):
                drawRect(item1.bottom-UNCONNECT_SIZE, item1.bottom+UNCONNECT_SIZE, Math.max(item1.left, item2.left)+UNCONNECT_SIZE, Math.min(item1.right, item2.right)-UNCONNECT_SIZE, CONNECT_BACKGROUND)
                break;
            case(RIGHT):
                drawRect(Math.max(item1.top, item2.top)+UNCONNECT_SIZE, Math.min(item1.bottom, item2.bottom)-UNCONNECT_SIZE, item1.right-UNCONNECT_SIZE, item1.right+UNCONNECT_SIZE, CONNECT_BACKGROUND)
                break;
        }
    };


    const findBox = (x,y, items) => {
        // for (let box of boxes) {
        for (let i = 0; i < boxes.length; i++) {
            let box = boxes[i]
            if (ctx.isPointInPath(box, x, y)) {
                return items[i];
            }
        }
        return undefined;
    }

    let highlighed = undefined;
    const mouseMoveEventHandler = (event, items) => {
        const item = findBox(event.offsetX * eventXScale, event.offsetY * eventYScale, items);
        if (highlighed == item) {
            return;
        }
        if (highlighed) {
            render(highlighed)
            // ctx.lineWidth = WIDTH_DEFAULT  * scalingFactor;
            // ctx.strokeStyle = STOKE_DEFAULT;
            // ctx.stroke(highlighed);
            // ctx.fillStyle = BACKGROUND_ITEM;
            // ctx.fill(highlighed);
        } 
        highlighed = item;
        if (highlighed) {
            // console.log(highlighed);
            render(highlighed, HIGHLIGHTED)
        }
}

    return { render, renderAdjacent, mouseMoveEventHandler};
    
}

const mergeBox = (item1, item2) => ({
    top: Math.min(item1.top, item2.top),
    bottom: Math.max(item1.bottom, item2.bottom),
    left: Math.min(item1.left, item2.left),
    right: Math.max(item1.right, item2.right),
})

const VOID_BOX = {
    top: Infinity,
    bottom: -Infinity,
    left: Infinity,
    right: -Infinity,
}

const boundingBox = items => {
    return items.reduce(mergeBox, VOID_BOX)
}



  // Draw label

  function drawBoxes(canvas, items, itemData) {

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const padding = 10;
    const minBoxSize = 50;
    const aspectRatio = 16 / 9; // Set the aspect ratio of the canvas
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const canvasWidth = windowWidth - padding * 2;
    const canvasHeight = windowHeight - padding * 2;
    const canvasAspectRatio = canvasWidth / canvasHeight;
    const scalingFactor = canvasAspectRatio > aspectRatio
      ? canvasHeight / (Math.max(...items.map(b => b.height)) * 1.1)
      : canvasWidth / (Math.max(...items.map(b => b.width)) * 1.1);

    const view = makeRender(canvas, itemData, boundingBox(items), scalingFactor);

    for (let item of items) {
        view.render(item);
    }

    const queue = [...items]
    while (queue.length) {
        let item = queue.shift();
        for (let i of queue) {
            const direction = adjacent(item, i)
            if (direction) {
                if (connected(item, i, direction, itemData)) {
                    view.renderAdjacent(item, i, direction);
                }
            }
        }
    }

    return {
        "mouseMoveEventHandler": event => view.mouseMoveEventHandler(event, items)
    }

  }


export { decode, drawBoxes, readItems, readData }