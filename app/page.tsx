{/* Bac */}
<Card>
  <CardHeader className="flex items-center justify-between">
    <CardTitle>Bac (non classés)</CardTitle>
    {showAlphaNav && (
      <div className="flex items-center gap-1 flex-wrap">
        <button
          className={chipCls(poolAlpha === null)}
          onClick={() => setPoolAlpha(null)}
          title="Toutes les tranches"
        >
          Tous
        </button>
        {ALPHA_BUCKETS.map((k) => (
          <button
            key={k}
            className={chipCls(poolAlpha === k)}
            onClick={() => setPoolAlpha(prev => prev === k ? null : k)}
            title={`Filtrer: ${k[0]}–${k[1]}`}
          >
            {k[0]}–{k[1]}
          </button>
        ))}
      </div>
    )}
  </CardHeader>

  <CardContent className={T.cardBg}>
    <SortableContext items={alphaFilteredPoolIds} strategy={rectSortingStrategy}>
      <Droppable id={state.poolId}>
        <div
          className="flex flex-wrap gap-2 p-2"
          style={{ contain: "layout paint" }}
          onClick={(e) => {
            // ignorer si clic sur une tuile
            if ((e.target as HTMLElement)?.closest?.("[data-item-id]")) return;
            if (!selectedId) return;
            if (getContainerByItem(selectedId) === state.poolId) return; // déjà au bac
            moveToContainer(selectedId, state.poolId);
          }}
        >
          {alphaFilteredPoolIds.map((itemId) => (
            <Tile
              key={itemId}
              id={itemId}
              name={state.items[itemId]?.name ?? itemId}
              image={state.items[itemId]?.image}
              comment={state.items[itemId]?.comment}
              tileSize={state.tileSize}
              selected={selectedId === itemId}
              highlighted={matchedIds.has(itemId)}
              onClick={() => setSelectedId(itemId)}
              isCommentOpen={openCommentId === itemId}
              onCommentToggle={toggleCommentFor}
            />
          ))}
        </div>
      </Droppable>
    </SortableContext>
  </CardContent>
</Card>
