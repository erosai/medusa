import { Adjustments } from "@medusajs/icons"
import { Button, DropdownMenu, clx } from "@medusajs/ui"
import {
  Cell,
  CellContext,
  ColumnDef,
  Row,
  Table,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ScrollToOptions,
  VirtualItem,
  useVirtualizer,
} from "@tanstack/react-virtual"
import FocusTrap from "focus-trap-react"
import {
  FocusEvent,
  MouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { FieldValues, Path, PathValue, UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { useCommandHistory } from "../../../hooks/use-command-history"
import { DataGridContext } from "../context"
import { useGridQueryTool } from "../hooks"
import { BulkUpdateCommand, Matrix, UpdateCommand } from "../models"
import { CellCoords, CellType } from "../types"
import {
  convertArrayToPrimitive,
  generateCellId,
  getColumnName,
  isCellMatch,
} from "../utils"

interface DataGridRootProps<
  TData,
  TFieldValues extends FieldValues = FieldValues
> {
  data?: TData[]
  columns: ColumnDef<TData>[]
  state: UseFormReturn<TFieldValues>
  getSubRows?: (row: TData) => TData[] | undefined
  onEditingChange?: (isEditing: boolean) => void
}

const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]
const VERTICAL_KEYS = ["ArrowUp", "ArrowDown"]

const ROW_HEIGHT = 40

/**
 * TODO:
 * - [Important] Show field errors in the grid, and in topbar.
 * - [Minor] Extend the commands to also support modifying the anchor and rangeEnd, to restore the previous focus after undo/redo.
 * - [Minor] Add shortcuts overview modal.
 * - [Stretch] Add support for only showing rows with errors.
 * - [Stretch] Calculate all viable cells without having to render them first.
 */

export const DataGridRoot = <
  TData,
  TFieldValues extends FieldValues = FieldValues
>({
  data = [],
  columns,
  state,
  getSubRows,
  onEditingChange,
}: DataGridRootProps<TData, TFieldValues>) => {
  const containerRef = useRef<HTMLDivElement>(null)

  const { redo, undo, execute } = useCommandHistory()
  const { register, control, getValues, setValue } = state

  const [trapActive, setTrapActive] = useState(false)

  const [anchor, setAnchor] = useState<CellCoords | null>(null)
  const [rangeEnd, setRangeEnd] = useState<CellCoords | null>(null)
  const [dragEnd, setDragEnd] = useState<CellCoords | null>(null)

  const [isSelecting, setIsSelecting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const [isEditing, setIsEditing] = useState(false)

  const onEditingChangeHandler = useCallback(
    (value: boolean) => {
      if (onEditingChange) {
        onEditingChange(value)
      }

      setIsEditing(value)
    },
    [onEditingChange]
  )

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const grid = useReactTable({
    data: data,
    columns,
    state: {
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
    getSubRows,
    getCoreRowModel: getCoreRowModel(),
    defaultColumn: {
      size: 200,
      maxSize: 400,
    },
  })

  const { flatRows } = grid.getRowModel()

  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => containerRef.current,
    overscan: 5,
    rangeExtractor: (range) => {
      const toRender = new Set(
        Array.from(
          { length: range.endIndex - range.startIndex + 1 },
          (_, i) => range.startIndex + i
        )
      )

      if (anchor) {
        toRender.add(anchor.row)
      }

      if (rangeEnd) {
        toRender.add(rangeEnd.row)
      }

      return Array.from(toRender).sort((a, b) => a - b)
    },
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const visibleColumns = grid.getVisibleLeafColumns()

  const columnVirtualizer = useVirtualizer({
    count: visibleColumns.length,
    estimateSize: (index) => visibleColumns[index].getSize(),
    getScrollElement: () => containerRef.current,
    horizontal: true,
    overscan: 3,
    rangeExtractor: (range) => {
      const startIndex = range.startIndex
      const endIndex = range.endIndex

      const toRender = new Set(
        Array.from(
          { length: endIndex - startIndex + 1 },
          (_, i) => startIndex + i
        )
      )

      if (anchor) {
        toRender.add(anchor.col)
      }

      if (rangeEnd) {
        toRender.add(rangeEnd.col)
      }

      return Array.from(toRender).sort((a, b) => a - b)
    },
  })

  const virtualColumns = columnVirtualizer.getVirtualItems()

  let virtualPaddingLeft: number | undefined
  let virtualPaddingRight: number | undefined

  if (columnVirtualizer && virtualColumns?.length) {
    virtualPaddingLeft = virtualColumns[0]?.start ?? 0
    virtualPaddingRight =
      columnVirtualizer.getTotalSize() -
      (virtualColumns[virtualColumns.length - 1]?.end ?? 0)
  }

  const scrollToCell = useCallback(
    (coords: CellCoords, direction: "horizontal" | "vertical" | "both") => {
      if (!anchor) {
        return
      }

      const { row, col } = coords
      const { row: anchorRow, col: anchorCol } = anchor

      const rowDirection = row >= anchorRow ? "down" : "up"
      const colDirection = col >= anchorCol ? "right" : "left"

      let toRow = rowDirection === "down" ? row + 1 : row - 1
      if (flatRows[toRow] === undefined) {
        toRow = row
      }

      let toCol = colDirection === "right" ? col + 1 : col - 1
      if (visibleColumns[toCol] === undefined) {
        toCol = col
      }

      const scrollOptions: ScrollToOptions = { align: "auto", behavior: "auto" }

      if (direction === "horizontal" || direction === "both") {
        columnVirtualizer.scrollToIndex(toCol, scrollOptions)
      }

      if (direction === "vertical" || direction === "both") {
        rowVirtualizer.scrollToIndex(toRow, scrollOptions)
      }
    },
    [anchor, columnVirtualizer, flatRows, rowVirtualizer, visibleColumns]
  )

  const matrix = useMemo(
    () => new Matrix(flatRows.length, visibleColumns.length),
    [flatRows, visibleColumns]
  )

  const queryTool = useGridQueryTool(containerRef)

  const registerCell = useCallback(
    (coords: CellCoords, field: string, type: CellType) => {
      matrix.registerField(coords.row, coords.col, field, type)
    },
    [matrix]
  )

  const setSingleRange = useCallback((coordinates: CellCoords | null) => {
    setAnchor(coordinates)
    setRangeEnd(coordinates)
  }, [])

  const getSelectionValues = useCallback(
    (fields: string[]): PathValue<TFieldValues, Path<TFieldValues>>[] => {
      if (!fields.length) {
        return []
      }

      return fields.map((field) => {
        return getValues(field as Path<TFieldValues>)
      })
    },
    [getValues]
  )

  const getIsCellSelected = useCallback(
    (cell: CellCoords | null) => {
      if (!cell || !anchor || !rangeEnd) {
        return false
      }

      return matrix.getIsCellSelected(cell, anchor, rangeEnd)
    },
    [anchor, rangeEnd, matrix]
  )

  const getIsCellDragSelected = useCallback(
    (cell: CellCoords | null) => {
      if (!cell || !anchor || !dragEnd) {
        return false
      }

      return matrix.getIsCellSelected(cell, anchor, dragEnd)
    },
    [anchor, dragEnd, matrix]
  )

  const setSelectionValues = useCallback(
    (fields: string[], values: string[]) => {
      if (!fields.length || !anchor) {
        return
      }

      const type = matrix.getCellType(anchor)

      if (!type) {
        return
      }

      const convertedValues = convertArrayToPrimitive(values, type)

      fields.forEach((field, index) => {
        if (!field) {
          return
        }

        const valueIndex = index % values.length
        const value = convertedValues[valueIndex] as PathValue<
          TFieldValues,
          Path<TFieldValues>
        >

        setValue(field as Path<TFieldValues>, value, {
          shouldDirty: true,
          shouldTouch: true,
        })
      })
    },
    [matrix, anchor, setValue]
  )

  /**
   * BUG: Sometimes the virtualizers will fail to scroll to the next/prev cell,
   * due to the element measurement not being part of the virtualizers memoized
   * array of measurements.
   *
   * Need to investigate why this is happening. A potential fix would be to
   * roll our own scroll management.
   */
  const handleKeyboardNavigation = useCallback(
    (e: KeyboardEvent) => {
      if (!anchor) {
        return
      }

      const type = matrix.getCellType(anchor)

      /**
       * If the user is currently editing a cell, we don't want to
       * handle the keyboard navigation.
       *
       * If the cell is of type boolean, we don't want to ignore the
       * keyboard navigation, as we want to allow the user to navigate
       * away from the cell directly, as you cannot "enter" a boolean cell.
       */
      if (isEditing && type !== "boolean") {
        return
      }

      const direction = VERTICAL_KEYS.includes(e.key)
        ? "vertical"
        : "horizontal"

      /**
       * If the user performs a horizontal navigation, we want to
       * use the anchor as the basis for the navigation.
       *
       * If the user performs a vertical navigation, the bases depends
       * on the type of interaction. If the user is holding shift, we want
       * to use the rangeEnd as the basis. If the user is not holding shift,
       * we want to use the anchor as the basis.
       */
      const basis =
        direction === "horizontal" ? anchor : e.shiftKey ? rangeEnd : anchor

      const updater =
        direction === "horizontal"
          ? setSingleRange
          : e.shiftKey
          ? setRangeEnd
          : setSingleRange

      if (!basis) {
        return
      }

      const { row, col } = basis

      const handleNavigation = (coords: CellCoords) => {
        e.preventDefault()

        scrollToCell(coords, direction)
        updater(coords)
      }

      const next = matrix.getValidMovement(
        row,
        col,
        e.key,
        e.metaKey || e.ctrlKey
      )

      handleNavigation(next)
    },
    [isEditing, anchor, rangeEnd, scrollToCell, setSingleRange, matrix]
  )

  const handleUndo = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()

      if (e.shiftKey) {
        redo()
        return
      }

      undo()
    },
    [redo, undo]
  )

  const handleSpaceKeyBoolean = useCallback(
    (anchor: CellCoords) => {
      const end = rangeEnd ?? anchor

      const fields = matrix.getFieldsInSelection(anchor, end)

      const prev = getSelectionValues(fields) as boolean[]

      const allChecked = prev.every((value) => value === true)
      const next = Array.from({ length: prev.length }, () => !allChecked)

      const command = new BulkUpdateCommand({
        fields,
        next,
        prev,
        setter: setSelectionValues,
      })

      execute(command)
    },
    [rangeEnd, matrix, getSelectionValues, setSelectionValues, execute]
  )

  const handleSpaceKeyTextOrNumber = useCallback(
    (anchor: CellCoords) => {
      const field = matrix.getCellField(anchor)
      const input = queryTool?.getInput(anchor)

      if (!field || !input) {
        return
      }

      const current = getValues(field as Path<TFieldValues>)
      const next = ""

      const command = new UpdateCommand({
        next,
        prev: current,
        setter: (value) => {
          setValue(field as Path<TFieldValues>, value, {
            shouldDirty: true,
            shouldTouch: true,
          })
        },
      })

      execute(command)

      input.focus()
    },
    [matrix, queryTool, getValues, execute, setValue]
  )

  const handleSpaceKey = useCallback(
    (e: KeyboardEvent) => {
      if (!anchor || isEditing) {
        return
      }

      e.preventDefault()

      const type = matrix.getCellType(anchor)

      if (!type) {
        return
      }

      switch (type) {
        case "boolean":
          handleSpaceKeyBoolean(anchor)
          break
        case "select":
        case "number":
        case "text":
          handleSpaceKeyTextOrNumber(anchor)
          break
      }
    },
    [
      anchor,
      isEditing,
      matrix,
      handleSpaceKeyBoolean,
      handleSpaceKeyTextOrNumber,
    ]
  )

  const handleMoveOnEnter = useCallback(
    (e: KeyboardEvent, anchor: CellCoords) => {
      const direction = e.shiftKey ? "ArrowUp" : "ArrowDown"
      const pos = matrix.getValidMovement(
        anchor.row,
        anchor.col,
        direction,
        false
      )

      if (anchor.row !== pos.row || anchor.col !== pos.col) {
        setSingleRange(pos)
        scrollToCell(pos, "vertical")
      } else {
        // If the the user is at the last cell, we want to focus the container of the cell.
        const container = queryTool?.getContainer(anchor)

        container?.focus()
      }

      onEditingChangeHandler(false)
    },
    [queryTool, matrix, scrollToCell, setSingleRange, onEditingChangeHandler]
  )

  const handleEditOnEnter = useCallback(
    (anchor: CellCoords) => {
      const input = queryTool?.getInput(anchor)

      if (!input) {
        return
      }

      input.focus()
      onEditingChangeHandler(true)
    },
    [queryTool, onEditingChangeHandler]
  )

  /**
   * Handles the enter key for text and number cells.
   *
   * The behavior is as follows:
   * - If the cell is currently not being edited, start editing the cell.
   * - If the cell is currently being edited, move to the next cell.
   */
  const handleEnterKeyTextOrNumber = useCallback(
    (e: KeyboardEvent, anchor: CellCoords) => {
      if (isEditing) {
        handleMoveOnEnter(e, anchor)
        return
      }

      handleEditOnEnter(anchor)
    },
    [handleMoveOnEnter, handleEditOnEnter, isEditing]
  )

  /**
   * Handles the enter key for boolean cells.
   *
   * The behavior is as follows:
   * - If the cell is currently undefined, set it to true.
   * - If the cell is currently a boolean, invert the value.
   * - After the value has been set, move to the next cell.
   */
  const handleEnterKeyBoolean = useCallback(
    (e: KeyboardEvent, anchor: CellCoords) => {
      const field = matrix.getCellField(anchor)

      if (!field) {
        return
      }

      const current = getValues(field as Path<TFieldValues>)
      let next: boolean

      if (typeof current === "boolean") {
        next = !current
      } else {
        next = true
      }

      const command = new UpdateCommand({
        next,
        prev: current,
        setter: (value) => {
          setValue(field as Path<TFieldValues>, value, {
            shouldDirty: true,
            shouldTouch: true,
          })
        },
      })

      execute(command)
      handleMoveOnEnter(e, anchor)
    },
    [execute, getValues, handleMoveOnEnter, matrix, setValue]
  )

  const handleEnterKey = useCallback(
    (e: KeyboardEvent) => {
      if (!anchor) {
        return
      }

      e.preventDefault()

      const type = matrix.getCellType(anchor)

      switch (type) {
        case "text":
        case "number":
          handleEnterKeyTextOrNumber(e, anchor)
          break
        case "boolean": {
          handleEnterKeyBoolean(e, anchor)
          break
        }
      }
    },
    [anchor, matrix, handleEnterKeyTextOrNumber, handleEnterKeyBoolean]
  )

  const handleDeleteKeyTextOrNumber = useCallback(
    (anchor: CellCoords, rangeEnd: CellCoords) => {
      const fields = matrix.getFieldsInSelection(anchor, rangeEnd)
      const prev = getSelectionValues(fields)
      const next = Array.from({ length: prev.length }, () => "")

      const command = new BulkUpdateCommand({
        fields,
        next,
        prev,
        setter: setSelectionValues,
      })

      execute(command)
    },
    [matrix, getSelectionValues, setSelectionValues, execute]
  )

  const handleDeleteKeyBoolean = useCallback(
    (anchor: CellCoords, rangeEnd: CellCoords) => {
      const fields = matrix.getFieldsInSelection(anchor, rangeEnd)
      const prev = getSelectionValues(fields)
      const next = Array.from({ length: prev.length }, () => false)

      const command = new BulkUpdateCommand({
        fields,
        next,
        prev,
        setter: setSelectionValues,
      })

      execute(command)
    },
    [execute, getSelectionValues, matrix, setSelectionValues]
  )

  const handleDeleteKey = useCallback(
    (e: KeyboardEvent) => {
      if (!anchor || !rangeEnd || isEditing) {
        return
      }

      e.preventDefault()

      const type = matrix.getCellType(anchor)

      if (!type) {
        return
      }

      switch (type) {
        case "text":
        case "number":
          handleDeleteKeyTextOrNumber(anchor, rangeEnd)
          break
        case "boolean":
          handleDeleteKeyBoolean(anchor, rangeEnd)
          break
      }
    },
    [
      anchor,
      rangeEnd,
      isEditing,
      matrix,
      handleDeleteKeyTextOrNumber,
      handleDeleteKeyBoolean,
    ]
  )

  const handleEscapeKey = useCallback(
    (e: KeyboardEvent) => {
      if (!anchor || !isEditing) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      // Restore focus to the container element
      const container = queryTool?.getContainer(anchor)
      container?.focus()
    },
    [queryTool, isEditing, anchor]
  )

  const handleTabKey = useCallback(
    (e: KeyboardEvent) => {
      if (!anchor || isEditing) {
        return
      }

      e.preventDefault()

      const direction = e.shiftKey ? "ArrowLeft" : "ArrowRight"

      const next = matrix.getValidMovement(
        anchor.row,
        anchor.col,
        direction,
        e.metaKey || e.ctrlKey
      )

      setSingleRange(next)
      scrollToCell(next, "horizontal")
    },
    [anchor, isEditing, scrollToCell, setSingleRange, matrix]
  )

  const handleKeyDownEvent = useCallback(
    (e: KeyboardEvent) => {
      if (ARROW_KEYS.includes(e.key)) {
        handleKeyboardNavigation(e)
        return
      }

      if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        console.log("Undo/Redo")
        handleUndo(e)
        return
      }

      if (e.key === " ") {
        handleSpaceKey(e)
        return
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        handleDeleteKey(e)
        return
      }

      if (e.key === "Enter") {
        handleEnterKey(e)
        return
      }

      if (e.key === "Escape") {
        handleEscapeKey(e)
        return
      }

      if (e.key === "Tab") {
        handleTabKey(e)
        return
      }
    },
    [
      handleEscapeKey,
      handleKeyboardNavigation,
      handleUndo,
      handleSpaceKey,
      handleEnterKey,
      handleDeleteKey,
      handleTabKey,
    ]
  )

  const handleDragEnd = useCallback(() => {
    if (!isDragging) {
      return
    }

    if (!anchor || !dragEnd) {
      return
    }
    const dragSelection = matrix.getFieldsInSelection(anchor, dragEnd)
    const anchorField = matrix.getCellField(anchor)

    if (!anchorField || !dragSelection.length) {
      return
    }

    const anchorValue = getSelectionValues([anchorField])
    const fields = dragSelection.filter((field) => field !== anchorField)

    const prev = getSelectionValues(fields)
    const next = Array.from({ length: prev.length }, () => anchorValue[0])

    const command = new BulkUpdateCommand({
      fields,
      prev,
      next,
      setter: setSelectionValues,
    })

    execute(command)

    setIsDragging(false)
    setDragEnd(null)

    setRangeEnd(dragEnd)
  }, [
    isDragging,
    anchor,
    dragEnd,
    matrix,
    getSelectionValues,
    setSelectionValues,
    execute,
  ])

  const handleMouseUpEvent = useCallback(() => {
    handleDragEnd()
    setIsSelecting(false)
  }, [handleDragEnd])

  const handleCopyEvent = useCallback(
    (e: ClipboardEvent) => {
      if (isEditing || !anchor || !rangeEnd) {
        return
      }

      e.preventDefault()

      const fields = matrix.getFieldsInSelection(anchor, rangeEnd)
      const values = getSelectionValues(fields)

      const text = values.map((value) => `${value}` ?? "").join("\t")

      e.clipboardData?.setData("text/plain", text)
    },
    [isEditing, anchor, rangeEnd, matrix, getSelectionValues]
  )

  const handlePasteEvent = useCallback(
    (e: ClipboardEvent) => {
      if (isEditing || !anchor || !rangeEnd) {
        return
      }

      e.preventDefault()

      const text = e.clipboardData?.getData("text/plain")

      if (!text) {
        return
      }

      const next = text.split("\t")

      const fields = matrix.getFieldsInSelection(anchor, rangeEnd)
      const prev = getSelectionValues(fields)

      const command = new BulkUpdateCommand({
        fields,
        next,
        prev,
        setter: setSelectionValues,
      })

      execute(command)
    },
    [
      isEditing,
      anchor,
      rangeEnd,
      matrix,
      getSelectionValues,
      setSelectionValues,
      execute,
    ]
  )

  useEffect(() => {
    const container = containerRef.current

    if (
      !container ||
      !container.contains(document.activeElement) ||
      !trapActive
    ) {
      return
    }

    container.addEventListener("keydown", handleKeyDownEvent)
    container.addEventListener("mouseup", handleMouseUpEvent)

    // Copy and paste event listeners need to be added to the window
    window.addEventListener("copy", handleCopyEvent)
    window.addEventListener("paste", handlePasteEvent)

    return () => {
      container.removeEventListener("keydown", handleKeyDownEvent)
      container.removeEventListener("mouseup", handleMouseUpEvent)

      window.removeEventListener("copy", handleCopyEvent)
      window.removeEventListener("paste", handlePasteEvent)
    }
  }, [
    trapActive,
    handleKeyDownEvent,
    handleMouseUpEvent,
    handleCopyEvent,
    handlePasteEvent,
  ])

  const getWrapperFocusHandler = useCallback(
    (coords: CellCoords) => {
      return (_e: FocusEvent<HTMLElement>) => {
        setSingleRange(coords)
      }
    },
    [setSingleRange]
  )

  const getOverlayMouseDownHandler = useCallback(
    (coords: CellCoords) => {
      return (e: MouseEvent<HTMLElement>) => {
        e.stopPropagation()
        e.preventDefault()

        if (e.shiftKey) {
          setRangeEnd(coords)
          return
        }

        setIsSelecting(true)

        setSingleRange(coords)
      }
    },
    [setSingleRange]
  )

  const getWrapperMouseOverHandler = useCallback(
    (coords: CellCoords) => {
      if (!isDragging && !isSelecting) {
        return
      }

      return (_e: MouseEvent<HTMLElement>) => {
        /**
         * If the column is not the same as the anchor col,
         * we don't want to select the cell.
         */
        if (anchor?.col !== coords.col) {
          return
        }

        if (isSelecting) {
          setRangeEnd(coords)
        } else {
          setDragEnd(coords)
        }
      }
    },
    [anchor, isDragging, isSelecting]
  )

  const getInputChangeHandler = useCallback(
    // Using `any` here as the generic type of Path<TFieldValues> will
    // not be inferred correctly.
    (field: any) => {
      return (next: any, prev: any) => {
        const command = new UpdateCommand({
          next,
          prev,
          setter: (value) => {
            setValue(field, value)
          },
        })

        execute(command)
      }
    },
    [setValue, execute]
  )

  const onDragToFillStart = useCallback((_e: MouseEvent<HTMLElement>) => {
    setIsDragging(true)
  }, [])

  /** Effects */

  /**
   * Auto corrective effect for ensuring we always
   * have a range end.
   */
  useEffect(() => {
    if (!anchor) {
      return
    }

    if (rangeEnd) {
      return
    }

    setRangeEnd(anchor)
  }, [anchor, rangeEnd])

  useEffect(() => {
    if (!anchor && matrix) {
      const coords = matrix.getFirstNavigableCell()

      if (coords) {
        setSingleRange(coords)
      }
    }
  }, [anchor, matrix, setSingleRange])

  const values = useMemo(
    () => ({
      anchor,
      control,
      trapActive,
      setIsSelecting,
      setIsEditing: onEditingChangeHandler,
      setSingleRange,
      setRangeEnd,
      getWrapperFocusHandler,
      getInputChangeHandler,
      getOverlayMouseDownHandler,
      getWrapperMouseOverHandler,
      register,
      registerCell,
      getIsCellSelected,
      getIsCellDragSelected,
    }),
    [
      anchor,
      control,
      trapActive,
      setIsSelecting,
      onEditingChangeHandler,
      setSingleRange,
      setRangeEnd,
      getWrapperFocusHandler,
      getInputChangeHandler,
      getOverlayMouseDownHandler,
      getWrapperMouseOverHandler,
      register,
      registerCell,
      getIsCellSelected,
      getIsCellDragSelected,
    ]
  )

  return (
    <DataGridContext.Provider value={values}>
      <div className="bg-ui-bg-subtle flex size-full flex-col">
        <DataGridHeader grid={grid} />
        <FocusTrap
          active={trapActive}
          focusTrapOptions={{
            initialFocus: () => {
              if (!anchor) {
                const coords = matrix.getFirstNavigableCell()

                if (!coords) {
                  return undefined
                }

                const id = generateCellId(coords)

                return containerRef.current?.querySelector(
                  `[data-container-id="${id}"]`
                )
              }

              const id = generateCellId(anchor)

              const anchorContainer = containerRef.current?.querySelector(
                `[data-container-id="${id}`
              ) as HTMLElement | null

              return anchorContainer ?? undefined
            },
            onActivate: () => setTrapActive(true),
            onDeactivate: () => setTrapActive(false),
            fallbackFocus: () => {
              if (!anchor) {
                const coords = matrix.getFirstNavigableCell()

                if (!coords) {
                  return containerRef.current!
                }

                const id = generateCellId(coords)

                const firstCell = containerRef.current?.querySelector(
                  `[data-container-id="${id}"]`
                ) as HTMLElement | null

                if (firstCell) {
                  return firstCell
                }

                return containerRef.current!
              }

              const id = generateCellId(anchor)

              const anchorContainer = containerRef.current?.querySelector(
                `[data-container-id="${id}`
              ) as HTMLElement | null

              if (anchorContainer) {
                return anchorContainer
              }

              return containerRef.current!
            },
            allowOutsideClick: true,
            escapeDeactivates: false,
          }}
        >
          <div className="size-full overflow-hidden">
            <div
              ref={containerRef}
              tabIndex={-1}
              onFocus={() => !trapActive && setTrapActive(true)}
              className="relative h-full select-none overflow-auto outline-none"
            >
              <div role="grid" className="text-ui-fg-subtle grid">
                <div
                  role="rowgroup"
                  className="txt-compact-small-plus bg-ui-bg-subtle sticky top-0 z-[1] grid"
                >
                  {grid.getHeaderGroups().map((headerGroup) => (
                    <div
                      role="row"
                      key={headerGroup.id}
                      className="flex h-10 w-full"
                    >
                      {virtualPaddingLeft ? (
                        <div
                          role="presentation"
                          style={{ display: "flex", width: virtualPaddingLeft }}
                        />
                      ) : null}
                      {virtualColumns.reduce((acc, vc, index, array) => {
                        const header = headerGroup.headers[vc.index]
                        const previousVC = array[index - 1]

                        if (previousVC && vc.index !== previousVC.index + 1) {
                          // If there's a gap between the current and previous virtual columns
                          acc.push(
                            <div
                              key={`padding-${previousVC.index}-${vc.index}`}
                              role="presentation"
                              style={{
                                display: "flex",
                                width: `${vc.start - previousVC.end}px`,
                              }}
                            />
                          )
                        }

                        acc.push(
                          <div
                            key={header.id}
                            role="columnheader"
                            data-column-index={vc.index}
                            style={{
                              width: header.getSize(),
                            }}
                            className="bg-ui-bg-base txt-compact-small-plus flex items-center border-b border-r px-4 py-2.5"
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                          </div>
                        )

                        return acc
                      }, [] as ReactNode[])}
                      {virtualPaddingRight ? (
                        <div
                          role="presentation"
                          style={{
                            display: "flex",
                            width: virtualPaddingRight,
                          }}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
                <div
                  role="rowgroup"
                  className="relative grid"
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {virtualRows.map((virtualRow) => {
                    const row = flatRows[virtualRow.index] as Row<TData>

                    return (
                      <DataGridRow
                        key={row.id}
                        row={row}
                        virtualRow={virtualRow}
                        visibleColumns={visibleColumns}
                        virtualColumns={virtualColumns}
                        anchor={anchor}
                        virtualPaddingLeft={virtualPaddingLeft}
                        virtualPaddingRight={virtualPaddingRight}
                        onDragToFillStart={onDragToFillStart}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </FocusTrap>
      </div>
    </DataGridContext.Provider>
  )
}

type DataGridHeaderProps<TData> = {
  grid: Table<TData>
}

const DataGridHeader = <TData,>({ grid }: DataGridHeaderProps<TData>) => {
  const { t } = useTranslation()

  return (
    <div className="bg-ui-bg-base flex items-center justify-between border-b p-4">
      <DropdownMenu>
        <DropdownMenu.Trigger asChild>
          <Button size="small" variant="secondary">
            <Adjustments />
            {t("dataGrid.editColumns")}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {grid.getAllLeafColumns().map((column) => {
            const checked = column.getIsVisible()
            const disabled = !column.getCanHide()

            if (disabled) {
              return null
            }

            return (
              <DropdownMenu.CheckboxItem
                key={column.id}
                checked={checked}
                onCheckedChange={(value) => column.toggleVisibility(value)}
                onSelect={(e) => e.preventDefault()}
              >
                {getColumnName(column)}
              </DropdownMenu.CheckboxItem>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu>
    </div>
  )
}

type DataGridCellProps<TData> = {
  cell: Cell<TData, unknown>
  columnIndex: number
  rowIndex: number
  anchor: CellCoords | null
  onDragToFillStart: (e: MouseEvent<HTMLElement>) => void
}

const DataGridCell = <TData,>({
  cell,
  columnIndex,
  rowIndex,
  anchor,
  onDragToFillStart,
}: DataGridCellProps<TData>) => {
  const coords: CellCoords = {
    row: rowIndex,
    col: columnIndex,
  }

  const isAnchor = isCellMatch(coords, anchor)

  return (
    <div
      role="gridcell"
      aria-rowindex={rowIndex}
      aria-colindex={columnIndex}
      style={{
        width: cell.column.getSize(),
      }}
      data-row-index={rowIndex}
      data-column-index={columnIndex}
      className={clx(
        "relative flex items-center border-b border-r p-0 outline-none"
      )}
      tabIndex={-1}
    >
      <div className="relative h-full w-full">
        {flexRender(cell.column.columnDef.cell, {
          ...cell.getContext(),
          columnIndex,
          rowIndex: rowIndex,
        } as CellContext<TData, any>)}
        {isAnchor && (
          <div
            onMouseDown={onDragToFillStart}
            className="bg-ui-fg-interactive absolute bottom-0 right-0 z-[3] size-1.5 cursor-ns-resize"
          />
        )}
      </div>
    </div>
  )
}

type DataGridRowProps<TData> = {
  row: Row<TData>
  virtualRow: VirtualItem<Element>
  virtualPaddingLeft?: number
  virtualPaddingRight?: number
  virtualColumns: VirtualItem<Element>[]
  visibleColumns: ColumnDef<TData>[]
  anchor: CellCoords | null
  onDragToFillStart: (e: MouseEvent<HTMLElement>) => void
}

const DataGridRow = <TData,>({
  row,
  virtualRow,
  virtualPaddingLeft,
  virtualPaddingRight,
  virtualColumns,
  visibleColumns,
  anchor,
  onDragToFillStart,
}: DataGridRowProps<TData>) => {
  const visibleCells = row.getVisibleCells()

  return (
    <div
      role="row"
      aria-rowindex={virtualRow.index}
      style={{
        transform: `translateY(${virtualRow.start}px)`,
      }}
      className="bg-ui-bg-subtle txt-compact-small absolute flex h-10 w-full"
    >
      {virtualPaddingLeft ? (
        <div
          role="presentation"
          style={{ display: "flex", width: virtualPaddingLeft }}
        />
      ) : null}
      {virtualColumns.reduce((acc, vc, index, array) => {
        const cell = visibleCells[vc.index]
        const column = cell.column
        const columnIndex = visibleColumns.findIndex((c) => c.id === column.id)
        const previousVC = array[index - 1]

        if (previousVC && vc.index !== previousVC.index + 1) {
          // If there's a gap between the current and previous virtual columns
          acc.push(
            <div
              key={`padding-${previousVC.index}-${vc.index}`}
              role="presentation"
              style={{
                display: "flex",
                width: `${vc.start - previousVC.end}px`,
              }}
            />
          )
        }

        acc.push(
          <DataGridCell
            key={cell.id}
            cell={cell}
            columnIndex={columnIndex}
            rowIndex={virtualRow.index}
            anchor={anchor}
            onDragToFillStart={onDragToFillStart}
          />
        )

        return acc
      }, [] as ReactNode[])}
      {virtualPaddingRight ? (
        <div
          role="presentation"
          style={{ display: "flex", width: virtualPaddingRight }}
        />
      ) : null}
    </div>
  )
}
